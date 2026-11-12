package ru.secreate.exchange;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.jdbc.core.JdbcTemplate;
import java.util.UUID;
import java.util.concurrent.Executors;
import static org.junit.jupiter.api.Assertions.*;

@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT, properties = "exchange.worker.enabled=false")
@Import(TestcontainersConfiguration.class)
class DeliveryTest {
    @Autowired ExchangeService service;
    @Autowired JdbcTemplate db;
    @org.springframework.beans.factory.annotation.Value("${local.server.port}") int port;
    @Autowired javax.sql.DataSource dataSource;

    @Test void workerTickDeliversSeveralReadyTasksInOneBoundedCycle() throws Exception {
        // This shared Testcontainers database retains rows between test methods. Defer older
        // READY work so this test measures its four fixtures, not unrelated earlier tests.
        db.update("update outbox set next_attempt=now()+interval '1 day' where state='READY'");
        var ids = new java.util.ArrayList<UUID>();
        String marker = UUID.randomUUID().toString();
        for (int i = 0; i < 4; i++) ids.add(service.create("alice", UUID.randomUUID().toString(), marker + "-" + i).id());

        var emulator = com.sun.net.httpserver.HttpServer.create(new java.net.InetSocketAddress("127.0.0.1", 0), 0);
        emulator.createContext("/operations/", exchange -> {
            String id = exchange.getRequestURI().getPath().substring("/operations/".length());
            byte[] response = (id + "|1|SUCCEEDED").getBytes(java.nio.charset.StandardCharsets.UTF_8);
            exchange.getResponseHeaders().set("Content-Type", "text/plain; charset=utf-8");
            exchange.sendResponseHeaders(200, response.length);
            exchange.getResponseBody().write(response);
            exchange.close();
        });
        emulator.start();
        try {
            var worker = new DeliveryWorker(service, "http://127.0.0.1:" + emulator.getAddress().getPort(), true, 3);
            worker.tick();

            for (int i = 0; i < ids.size(); i++) {
                var id = ids.get(i);
                assertEquals(i < 3 ? "DONE" : "READY", db.queryForObject("select state from outbox where task_id=?", String.class, id), id.toString());
            }
            worker.tick();
            for (var id : ids) {
                assertEquals("DONE", db.queryForObject("select state from outbox where task_id=?", String.class, id), id.toString());
                assertEquals("SUCCEEDED", service.get("alice", id).status(), id.toString());
            }
        } finally {
            emulator.stop(0);
        }
    }

    @Test void registryFiltersBeforePaginationAndEnforcesScope() throws Exception {
        String marker=UUID.randomUUID().toString();
        var problemIds=new java.util.ArrayList<UUID>();
        for(int i=0;i<22;i++) problemIds.add(service.create("alice",UUID.randomUUID().toString(),marker+i).id());
        for(var id:problemIds) db.update("update outbox set state='REVIEW' where task_id=?",id);
        var other=service.create("bob",UUID.randomUUID().toString(),"Other owner");
        db.update("update outbox set state='REVIEW' where task_id=?",other.id());
        String prefix="http://localhost:"+port+"/api/tasks?status=PENDING&page=";
        var first=api("GET",prefix+"0","alice:demo-alice",null);
        assertEquals(200,first.statusCode()); assertFalse(first.body().contains(other.id().toString()));
        assertTrue(first.body().matches("(?s).*\\\"created_at\\\":\\\"[^\\\"]+Z\\\".*"), first.body());
        var second=api("GET",prefix+"1","operator:demo-operator",null);
        assertEquals(200,second.statusCode()); assertFalse(second.body().contains(other.id().toString()));
        var mapper=tools.jackson.databind.json.JsonMapper.builder().build();
        var firstPage=mapper.readValue(first.body(),java.util.Map.class);
        var nextPage=mapper.readValue(second.body(),java.util.Map.class);
        assertEquals(20,((java.util.List<?>)firstPage.get("items")).size());
        assertEquals(true,firstPage.get("hasNext"));
        var firstIds=new java.util.HashSet<>();
        for(Object item:(java.util.List<?>)firstPage.get("items")) firstIds.add(((java.util.Map<?,?>)item).get("id"));
        for(Object item:(java.util.List<?>)nextPage.get("items")) assertFalse(firstIds.contains(((java.util.Map<?,?>)item).get("id")));
        assertEquals(first.body(),api("GET",prefix+"0","alice:demo-alice",null).body());
        var problems=api("GET","http://localhost:"+port+"/api/operator/tasks/problems?status=PENDING&page=0","operator:demo-operator",null);
        assertEquals(200,problems.statusCode());
        assertFalse(problems.body().contains(other.id().toString()));
        var problemPage=mapper.readValue(problems.body(),java.util.Map.class);
        assertEquals(20,((java.util.List<?>)problemPage.get("items")).size());
        assertEquals(true,problemPage.get("hasNext"));
        for(Object item:(java.util.List<?>)problemPage.get("items")) {
            var entry=(java.util.Map<?,?>)item;
            assertEquals("PENDING",entry.get("business_status"));
            assertEquals("REVIEW",entry.get("delivery_state"));
        }
        var noResults=api("GET","http://localhost:"+port+"/api/tasks?status=SUCCEEDED&page=0","alice:demo-alice",null);
        assertEquals(200,noResults.statusCode()); assertFalse(noResults.body().contains(marker));
    }

    @Test void concurrentAssignmentChangesOnceAndAuditsOldAndNew() throws Exception {
        var task=service.create("alice",UUID.randomUUID().toString(),"Assignment");
        String url="http://localhost:"+port+"/api/tasks/"+task.id()+"/assignee";
        try(var pool=Executors.newFixedThreadPool(2)) {
            var a=pool.submit(()->api("PATCH",url,"operator:demo-operator","{\"assignee\":\"alice\",\"version\":0}").statusCode());
            var b=pool.submit(()->api("PATCH",url,"operator:demo-operator","{\"assignee\":\"bob\",\"version\":0}").statusCode());
            assertEquals(java.util.Set.of(200,409),java.util.Set.of(a.get(),b.get()));
        }
        assertEquals(1,db.queryForObject("select count(*) from assignment_audit where task_id=? and actor='operator'",Integer.class,task.id()));
        var audit=db.queryForMap("select * from assignment_audit where task_id=?",task.id());
        assertNull(audit.get("old_assignee"));
        assertTrue(java.util.Set.of("alice","bob").contains(audit.get("new_assignee")));
        assertEquals(0L,((Number)audit.get("old_version")).longValue());
        assertEquals(1L,((Number)audit.get("new_version")).longValue());
        assertNotNull(audit.get("created_at"));
        assertEquals(403,api("PATCH",url,"alice:demo-alice","{\"assignee\":\"alice\",\"version\":1}").statusCode());
        var outside=service.create("bob",UUID.randomUUID().toString(),"Outside assignment scope");
        assertEquals(404,api("PATCH","http://localhost:"+port+"/api/tasks/"+outside.id()+"/assignee","operator:demo-operator","{\"assignee\":\"alice\",\"version\":0}").statusCode());
    }

    @Test void assignmentRollsBackWhenAuditCannotBeWritten() throws Exception {
        var task=service.create("alice",UUID.randomUUID().toString(),"Audit rollback");
        db.execute("alter table assignment_audit add constraint test_no_operator check (new_assignee <> 'operator') not valid");
        try {
            var response=api("PATCH","http://localhost:"+port+"/api/tasks/"+task.id()+"/assignee","operator:demo-operator","{\"assignee\":\"operator\",\"version\":0}");
            assertEquals(500,response.statusCode());
            var row=db.queryForMap("select assignee,local_version from tasks where id=?",task.id());
            assertNull(row.get("assignee"));
            assertEquals(0L,((Number)row.get("local_version")).longValue());
        } finally { db.execute("alter table assignment_audit drop constraint test_no_operator"); }
    }

    private java.net.http.HttpResponse<String> api(String method,String url,String login,String body) throws Exception {
        var request=java.net.http.HttpRequest.newBuilder(java.net.URI.create(url)).header("Authorization","Basic "+java.util.Base64.getEncoder().encodeToString(login.getBytes(java.nio.charset.StandardCharsets.UTF_8)));
        if(body!=null) request.header("Content-Type","application/json");
        return java.net.http.HttpClient.newHttpClient().send(request.method(method,body==null?java.net.http.HttpRequest.BodyPublishers.noBody():java.net.http.HttpRequest.BodyPublishers.ofString(body)).build(),java.net.http.HttpResponse.BodyHandlers.ofString());
    }
    @Autowired ReconciliationService reconciliation;

    @Test void duplicateJsonKeysAreRetainedAndCannotBeApplied() throws Exception {
        var task=service.create("alice",UUID.randomUUID().toString(),"Duplicate keys");
        String body="{\"operationId\":\""+task.id()+"\",\"version\":1,\"version\":2,\"status\":\"SUCCEEDED\",\"executions\":1}";
        assertInvalidBytes(task,body.getBytes(java.nio.charset.StandardCharsets.UTF_8));
    }

    @Test void nulByteResponseIsRetainedAndCannotBeApplied() throws Exception {
        var task=service.create("alice",UUID.randomUUID().toString(),"Nul byte");
        String body="{\"operationId\":\""+task.id()+"\",\"status\":\"SUCC"+(char)0+"EEDED\",\"version\":1,\"executions\":1}";
        assertInvalidBytes(task,body.getBytes(java.nio.charset.StandardCharsets.UTF_8));
    }

    private void assertInvalidBytes(ExchangeService.Task task,byte[] body) throws Exception {
        var server=com.sun.net.httpserver.HttpServer.create(new java.net.InetSocketAddress("127.0.0.1",0),0);
        server.createContext("/operations/",x -> {x.getResponseHeaders().set("Content-Type","application/json");x.sendResponseHeaders(200,body.length);x.getResponseBody().write(body);x.close();});
        server.start();
        Object previous=org.springframework.test.util.ReflectionTestUtils.getField(reconciliation,"client");
        org.springframework.test.util.ReflectionTestUtils.setField(reconciliation,"client",org.springframework.web.client.RestClient.create("http://localhost:"+server.getAddress().getPort()));
        try {
            String base="http://localhost:"+port+"/api/operator/tasks/"+task.id();
            assertEquals(200,operatorPost(base+"/reconcile","operator:demo-operator",null));
            var snapshot=db.queryForMap("select * from reconciliations where task_id=? order by observed_at desc limit 1",task.id());
            assertEquals("INVALID",snapshot.get("outcome"));
            assertEquals("MALFORMED_JSON",snapshot.get("invalid_reason"));
            assertArrayEquals(body,(byte[])snapshot.get("invalid_response_bytes"));
            assertEquals(409,operatorPost(base+"/reconciliations/"+snapshot.get("id")+"/apply","operator:demo-operator",null));
            assertEquals("PENDING",service.get("alice",task.id()).status());
            assertEquals(0,service.get("alice",task.id()).version());
        } finally {org.springframework.test.util.ReflectionTestUtils.setField(reconciliation,"client",previous);server.stop(0);}
    }

    @Test void operatorCannotCreateTask() throws Exception {
        var request=java.net.http.HttpRequest.newBuilder(java.net.URI.create("http://localhost:"+port+"/api/tasks"))
                .header("Authorization","Basic "+java.util.Base64.getEncoder().encodeToString("operator:demo-operator".getBytes(java.nio.charset.StandardCharsets.UTF_8)))
                .header("Content-Type","application/json").header("Idempotency-Key",UUID.randomUUID().toString())
                .POST(java.net.http.HttpRequest.BodyPublishers.ofString("{\"title\":\"No\"}")).build();
        assertEquals(403,java.net.http.HttpClient.newHttpClient().send(request,java.net.http.HttpResponse.BodyHandlers.ofString()).statusCode());
    }

    @Test void differentKeysCannotRescheduleTheSameFailure() throws Exception {
        var lease=freshLease(); service.finish(lease,false);
        String url="http://localhost:"+port+"/api/operator/tasks/"+lease.id()+"/retry";
        var keys=new java.util.ArrayList<String>();
        try(var pool=Executors.newFixedThreadPool(6)) {
            var results=new java.util.ArrayList<java.util.concurrent.Future<Integer>>();
            for(int i=0;i<8;i++) { String key=UUID.randomUUID().toString();keys.add(key);results.add(pool.submit(()->operatorPost(url,"operator:demo-operator",key))); }
            int successes=0; String winning=null;
            for(int i=0;i<results.size();i++) { int result=results.get(i).get(); if(result==200){successes++;winning=keys.get(i);}else assertEquals(409,result); }
            assertEquals(1,successes);
            var before=db.queryForMap("select next_attempt,attempt_limit from outbox where task_id=?",lease.id());
            assertEquals(409,operatorPost(url,"operator:demo-operator",UUID.randomUUID().toString()));
            assertEquals(200,operatorPost(url,"operator:demo-operator",winning));
            assertEquals(before,db.queryForMap("select next_attempt,attempt_limit from outbox where task_id=?",lease.id()));
            assertEquals(1,db.queryForObject("select count(*) from exchange_events where task_id=? and event='MANUAL_RECOVERY'",Integer.class,lease.id()));
        }
    }

    @Test void invalidExternalSnapshotsHaveReasonAndCannotBeApplied() throws Exception {
        var task=service.create("alice",UUID.randomUUID().toString(),"Invalid snapshot");
        var server=com.sun.net.httpserver.HttpServer.create(new java.net.InetSocketAddress("127.0.0.1",0),0);
        var response=new java.util.concurrent.atomic.AtomicReference<String>();
        server.createContext("/operations/",x -> { byte[] bytes=response.get().getBytes(java.nio.charset.StandardCharsets.UTF_8); x.getResponseHeaders().set("Content-Type","application/json");x.sendResponseHeaders(200,bytes.length);x.getResponseBody().write(bytes);x.close(); });
        server.start();
        Object previous=org.springframework.test.util.ReflectionTestUtils.getField(reconciliation,"client");
        org.springframework.test.util.ReflectionTestUtils.setField(reconciliation,"client",org.springframework.web.client.RestClient.create("http://localhost:"+server.getAddress().getPort()));
        try {
            String base="http://localhost:"+port+"/api/operator/tasks/"+task.id();
            for(String[] sample:new String[][] {
                    {"not-json","MALFORMED_JSON"},
                    {"{\"operationId\":\""+UUID.randomUUID()+"\",\"version\":1,\"status\":\"SUCCEEDED\",\"executions\":1}","OPERATION_ID_MISMATCH"},
                    {"{\"operationId\":\""+task.id()+"\",\"version\":0,\"status\":\"SUCCEEDED\",\"executions\":1}","INVALID_VERSION"},
                    {"{\"operationId\":\""+task.id()+"\",\"version\":1.5,\"status\":\"SUCCEEDED\",\"executions\":1}","NON_INTEGER_OR_OUT_OF_RANGE"},
                    {"{\"operationId\":\""+task.id()+"\",\"version\":9223372036854775808,\"status\":\"SUCCEEDED\",\"executions\":1}","NON_INTEGER_OR_OUT_OF_RANGE"},
                    {"{\"operationId\":\""+task.id()+"\",\"version\":1,\"status\":\"SUCCEEDED\",\"executions\":1.5}","NON_INTEGER_OR_OUT_OF_RANGE"},
                    {"{\"operationId\":\""+task.id()+"\",\"version\":1,\"status\":\"SUCCEEDED\",\"executions\":0}","INVALID_EXECUTIONS"},
                    {"{\"operationId\":\""+task.id()+"\",\"version\":1,\"status\":\"SUCCEEDED\",\"executions\":2}","INVALID_EXECUTIONS"} }) {
                response.set(sample[0]); assertEquals(200,operatorPost(base+"/reconcile","operator:demo-operator",null));
                var row=db.queryForMap("select * from reconciliations where task_id=? order by observed_at desc,id desc limit 1",task.id());
                assertEquals("INVALID",row.get("outcome")); assertEquals(sample[1],row.get("invalid_reason"));
                assertEquals(sample[0],row.get("invalid_response"));
                assertEquals(409,operatorPost(base+"/reconciliations/"+row.get("id")+"/apply","operator:demo-operator",null));
            }
        } finally { org.springframework.test.util.ReflectionTestUtils.setField(reconciliation,"client",previous); server.stop(0); }
    }

    @Test void slowReconciliationDoesNotHoldDeliveryLocks() throws Exception {
        var lease=freshLease();
        var entered=new java.util.concurrent.CountDownLatch(1); var release=new java.util.concurrent.CountDownLatch(1);
        var server=com.sun.net.httpserver.HttpServer.create(new java.net.InetSocketAddress("127.0.0.1",0),0);
        server.createContext("/operations/",x -> {
            entered.countDown(); try { release.await(5,java.util.concurrent.TimeUnit.SECONDS); } catch(InterruptedException e) { Thread.currentThread().interrupt(); }
            byte[] bytes=("{\"operationId\":\""+lease.id()+"\",\"version\":1,\"status\":\"SUCCEEDED\",\"executions\":1}").getBytes(java.nio.charset.StandardCharsets.UTF_8);
            x.getResponseHeaders().set("Content-Type","application/json");x.sendResponseHeaders(200,bytes.length);x.getResponseBody().write(bytes);x.close();
        }); server.start();
        Object previous=org.springframework.test.util.ReflectionTestUtils.getField(reconciliation,"client");
        org.springframework.test.util.ReflectionTestUtils.setField(reconciliation,"client",org.springframework.web.client.RestClient.create("http://localhost:"+server.getAddress().getPort()));
        try(var pool=Executors.newFixedThreadPool(2)) {
            var observe=pool.submit(()->operatorPost("http://localhost:"+port+"/api/operator/tasks/"+lease.id()+"/reconcile","operator:demo-operator",null));
            assertTrue(entered.await(3,java.util.concurrent.TimeUnit.SECONDS));
            var delivery=pool.submit(()->service.complete(lease,1,"SUCCEEDED"));
            try { assertTrue(delivery.get(2,java.util.concurrent.TimeUnit.SECONDS)); } finally { release.countDown(); }
            assertEquals(409,observe.get(5,java.util.concurrent.TimeUnit.SECONDS));
        } finally { release.countDown();org.springframework.test.util.ReflectionTestUtils.setField(reconciliation,"client",previous); server.stop(0); }
    }

    @Test void slowDecisionDoesNotHoldDeliveryLocks() throws Exception {
        var lease=freshLease();
        var entered=new java.util.concurrent.CountDownLatch(1); var release=new java.util.concurrent.CountDownLatch(1);
        var requests=new java.util.concurrent.atomic.AtomicInteger();
        var server=com.sun.net.httpserver.HttpServer.create(new java.net.InetSocketAddress("127.0.0.1",0),0);
        server.createContext("/operations/",x -> {
            if(requests.incrementAndGet()>1) {
                entered.countDown(); try { release.await(5,java.util.concurrent.TimeUnit.SECONDS); } catch(InterruptedException e) { Thread.currentThread().interrupt(); }
            }
            byte[] bytes=("{\"operationId\":\""+lease.id()+"\",\"version\":1,\"status\":\"SUCCEEDED\",\"executions\":1}").getBytes(java.nio.charset.StandardCharsets.UTF_8);
            x.getResponseHeaders().set("Content-Type","application/json");x.sendResponseHeaders(200,bytes.length);x.getResponseBody().write(bytes);x.close();
        }); server.start();
        Object previous=org.springframework.test.util.ReflectionTestUtils.getField(reconciliation,"client");
        org.springframework.test.util.ReflectionTestUtils.setField(reconciliation,"client",org.springframework.web.client.RestClient.create("http://localhost:"+server.getAddress().getPort()));
        try(var pool=Executors.newFixedThreadPool(2)) {
            String base="http://localhost:"+port+"/api/operator/tasks/"+lease.id();
            assertEquals(200,operatorPost(base+"/reconcile","operator:demo-operator",null));
            UUID snapshot=db.queryForObject("select id from reconciliations where task_id=? order by observed_at desc limit 1",UUID.class,lease.id());
            var decision=pool.submit(()->operatorPost(base+"/reconciliations/"+snapshot+"/apply","operator:demo-operator",null));
            assertTrue(entered.await(3,java.util.concurrent.TimeUnit.SECONDS));
            var delivery=pool.submit(()->service.complete(lease,1,"SUCCEEDED"));
            try { assertTrue(delivery.get(2,java.util.concurrent.TimeUnit.SECONDS)); } finally { release.countDown(); }
            assertEquals(409,decision.get(5,java.util.concurrent.TimeUnit.SECONDS));
        } finally { release.countDown();org.springframework.test.util.ReflectionTestUtils.setField(reconciliation,"client",previous);server.stop(0); }
    }

    @Test void operatorHistoryIsRoleAndScopeRestricted() throws Exception {
        var own=service.create("alice",UUID.randomUUID().toString(),"Accessible");
        var other=service.create("bob",UUID.randomUUID().toString(),"Outside scope");
        var http=java.net.http.HttpClient.newHttpClient();
        for (String[] sample : new String[][] {
                {"operator:demo-operator",own.id().toString(),"200"},
                {"operator:demo-operator",other.id().toString(),"404"},
                {"alice:demo-alice",own.id().toString(),"403"}}) {
            var req=java.net.http.HttpRequest.newBuilder(java.net.URI.create("http://localhost:"+port+"/api/operator/tasks/"+sample[1]))
                    .header("Authorization","Basic "+java.util.Base64.getEncoder().encodeToString(sample[0].getBytes(java.nio.charset.StandardCharsets.UTF_8))).GET().build();
            var response=http.send(req,java.net.http.HttpResponse.BodyHandlers.ofString());
            assertEquals(Integer.parseInt(sample[2]),response.statusCode());
            if (response.statusCode()==200) {
                assertTrue(response.body().contains("\"business_status\""));
                assertTrue(response.body().contains("\"delivery_state\""));
                assertTrue(response.body().contains("\"attempts\""));
                assertTrue(response.body().contains("\"history\""));
                assertTrue(response.body().contains("\"conflicts\""));
            }
        }
        for (String[] sample : new String[][] {
                {"alice:demo-alice",own.id().toString(),"200"},
                {"alice:demo-alice",other.id().toString(),"404"},
                {"bob:demo-bob",own.id().toString(),"404"}}) {
            var req=java.net.http.HttpRequest.newBuilder(java.net.URI.create("http://localhost:"+port+"/api/tasks/"+sample[1]))
                    .header("Authorization","Basic "+java.util.Base64.getEncoder().encodeToString(sample[0].getBytes(java.nio.charset.StandardCharsets.UTF_8))).GET().build();
            assertEquals(Integer.parseInt(sample[2]),http.send(req,java.net.http.HttpResponse.BodyHandlers.ofString()).statusCode());
        }
        var action=java.net.http.HttpRequest.newBuilder(java.net.URI.create("http://localhost:"+port+"/api/operator/tasks/"+own.id()+"/reconcile"))
                .header("Authorization","Basic "+java.util.Base64.getEncoder().encodeToString("alice:demo-alice".getBytes(java.nio.charset.StandardCharsets.UTF_8)))
                .POST(java.net.http.HttpRequest.BodyPublishers.noBody()).build();
        assertEquals(403,http.send(action,java.net.http.HttpResponse.BodyHandlers.ofString()).statusCode());
    }

    private ExchangeService.Lease freshLease() {
        db.update("update outbox set next_attempt=now()+interval '1 day'");
        service.create("alice",UUID.randomUUID().toString(),"Lease");
        return service.claim();
    }

    private ExchangeService.Task freshTask() {
        db.update("update outbox set next_attempt=now()+interval '1 day'");
        return service.create("alice",UUID.randomUUID().toString(),"Fault mode "+UUID.randomUUID());
    }

    private com.sun.net.httpserver.HttpServer resultServer(String response) throws Exception {
        var server=com.sun.net.httpserver.HttpServer.create(new java.net.InetSocketAddress("127.0.0.1",0),0);
        server.createContext("/operations/",exchange -> {
            byte[] body=response.getBytes(java.nio.charset.StandardCharsets.UTF_8);
            exchange.sendResponseHeaders(200,body.length);
            try(var output=exchange.getResponseBody()) { output.write(body); }
        });
        server.start();
        return server;
    }

    @Test void deliveryWorkerAppliesExactDuplicateBatchOnceOnPostgres() throws Exception {
        var task=freshTask();
        String result=task.id()+"|1|SUCCEEDED";
        var server=resultServer(result+"\n"+result);
        try {
            var worker=new DeliveryWorker(service,"http://127.0.0.1:"+server.getAddress().getPort(),false);
            assertTrue(worker.deliverOne());
            assertEquals("SUCCEEDED",service.get("alice",task.id()).status());
            assertEquals(1,service.get("alice",task.id()).version());
            assertEquals(1,db.queryForObject("select count(*) from exchange_events where task_id=? and event='RESULT_APPLY'",Integer.class,task.id()));
            assertEquals(0,db.queryForObject("select count(*) from result_conflicts where task_id=?",Integer.class,task.id()));
            assertEquals("DONE",db.queryForObject("select state from outbox where task_id=?",String.class,task.id()));
        } finally { server.stop(0); }
    }

    @Test void deliveryWorkerRejectsContradictorySameVersionBatchBeforeApplyOnPostgres() throws Exception {
        var task=freshTask();
        var server=resultServer(task.id()+"|1|SUCCEEDED\n"+task.id()+"|1|FAILED");
        try {
            var worker=new DeliveryWorker(service,"http://127.0.0.1:"+server.getAddress().getPort(),false);
            assertTrue(worker.deliverOne());
            var unchanged=service.get("alice",task.id());
            assertEquals("PENDING",unchanged.status());
            assertEquals(0,unchanged.version());
            var outbox=db.queryForMap("select state,lease_token,failure_reason from outbox where task_id=?",task.id());
            assertEquals("REVIEW",outbox.get("state"));
            assertNull(outbox.get("lease_token"));
            assertEquals("CONTRADICTORY_RESULT_BATCH",outbox.get("failure_reason"));
            var conflict=db.queryForMap("select * from result_conflicts where task_id=?",task.id());
            assertEquals("SUCCEEDED/FAILED",conflict.get("incoming_status"));
            assertEquals("CONTRADICTORY_RESULT_BATCH",conflict.get("reason"));
            assertEquals(1,((Number)conflict.get("attempt")).intValue());
            assertEquals(0L,((Number)conflict.get("current_version")).longValue());
            assertEquals(1L,((Number)conflict.get("incoming_version")).longValue());
            assertEquals(0,db.queryForObject("select count(*) from exchange_events where task_id=? and event='RESULT_APPLY'",Integer.class,task.id()));
            var problems=api("GET","http://localhost:"+port+"/api/operator/tasks/problems?page=0","operator:demo-operator",null);
            assertEquals(200,problems.statusCode());
            assertTrue(problems.body().contains(task.id().toString()));
            var problem=api("GET","http://localhost:"+port+"/api/operator/tasks/"+task.id(),"operator:demo-operator",null);
            assertEquals(200,problem.statusCode());
            assertTrue(problem.body().contains("CONTRADICTORY_RESULT_BATCH"));
            assertTrue(problem.body().contains("SUCCEEDED/FAILED"));
        } finally { server.stop(0); }
    }

    @Test void manualRecoveryAfterRepeatedConflictUsesNewKeyAndReplaysIdempotently() throws Exception {
        var task=freshTask();
        var server=resultServer(task.id()+"|1|SUCCEEDED\n"+task.id()+"|1|FAILED");
        String base="http://localhost:"+port+"/api/operator/tasks/"+task.id();
        var worker=new DeliveryWorker(service,"http://127.0.0.1:"+server.getAddress().getPort(),false);
        try {
            assertTrue(worker.deliverOne());
            assertEquals("REVIEW",db.queryForObject("select state from outbox where task_id=?",String.class,task.id()));

            String firstKey="recovery-k1-"+UUID.randomUUID();
            assertEquals(200,operatorPost(base+"/retry","operator:demo-operator",firstKey));
            assertRecoveryQueued(task.id(),1);
            assertEquals(200,operatorPost(base+"/retry","operator:demo-operator",firstKey));
            assertRecoveryQueued(task.id(),1);

            assertTrue(worker.deliverOne());
            assertEquals(2,db.queryForObject("select count(*) from exchange_events where task_id=? and event='RESULT_CONFLICT_REQUIRES_REVIEW'",Integer.class,task.id()));
            assertEquals("REVIEW",db.queryForObject("select state from outbox where task_id=?",String.class,task.id()));

            String secondKey="recovery-k2-"+UUID.randomUUID();
            assertNotEquals(firstKey,secondKey);
            assertEquals(200,operatorPost(base+"/retry","operator:demo-operator",secondKey));
            assertRecoveryQueued(task.id(),2);
            assertEquals(200,operatorPost(base+"/retry","operator:demo-operator",secondKey));
            assertRecoveryQueued(task.id(),2);
        } finally { server.stop(0); }
    }

    private void assertRecoveryQueued(UUID id,int expectedRecoveryEvents) {
        var outbox=db.queryForMap("select state,recovery_pending from outbox where task_id=?",id);
        assertEquals("READY",outbox.get("state"));
        assertEquals(true,outbox.get("recovery_pending"));
        assertEquals(expectedRecoveryEvents,db.queryForObject("select count(*) from exchange_events where task_id=? and event='MANUAL_RECOVERY'",Integer.class,id));
    }

    @Test void lateWorkerCannotApplyResultOrChangeOutbox() {
        var old=freshLease();
        db.update("update outbox set lease_until=now()-interval '1 second' where task_id=?",old.id());
        var current=service.claim();
        assertEquals(old.id(),current.id());
        assertFalse(service.complete(old,2,"FAILED"));
        assertEquals("PENDING",service.get("alice",old.id()).status());
        assertEquals(current.token(),db.queryForObject("select lease_token from outbox where task_id=?",UUID.class,old.id()));
    }

    @Test void completeRechecksLeaseAfterWaitingForTaskLock() throws Exception {
        var lease=freshLease();
        db.update("update outbox set lease_until=clock_timestamp()+interval '1200 milliseconds' where task_id=?",lease.id());
        var blocker=dataSource.getConnection();
        blocker.setAutoCommit(false);
        try (var statement=blocker.prepareStatement("select id from tasks where id=? for update")) {
            statement.setObject(1,lease.id());
            statement.executeQuery().close();
        }
        var executor=Executors.newSingleThreadExecutor();
        try {
            var result=executor.submit(()->service.complete(lease,1,"SUCCEEDED"));
            awaitLockWait("%from tasks where id%for update%");
            awaitLeaseExpiration(lease.id());
            blocker.commit();

            assertFalse(result.get(5,java.util.concurrent.TimeUnit.SECONDS));
            assertEquals("PENDING",service.get("alice",lease.id()).status());
            var outbox=db.queryForMap("select state,lease_token,attempts from outbox where task_id=?",lease.id());
            assertEquals("READY",outbox.get("state"));
            assertEquals(lease.token(),outbox.get("lease_token"));
            assertEquals(lease.attempts(),((Number)outbox.get("attempts")).intValue());
            assertEquals(0,db.queryForObject("select count(*) from exchange_events where task_id=? and event like 'RESULT_%'",Integer.class,lease.id()));
        } finally {
            blocker.close();
            executor.shutdownNow();
        }
    }

    @Test void contradictoryBatchRechecksLeaseAfterWaitingForTaskLock() throws Exception {
        var lease=freshLease();
        db.update("update outbox set lease_until=clock_timestamp()+interval '1200 milliseconds' where task_id=?",lease.id());
        var blocker=dataSource.getConnection();
        blocker.setAutoCommit(false);
        try (var statement=blocker.prepareStatement("select id from tasks where id=? for update")) {
            statement.setObject(1,lease.id());
            statement.executeQuery().close();
        }
        var executor=Executors.newSingleThreadExecutor();
        try {
            var result=executor.submit(()->service.rejectContradictoryBatch(lease,1,"SUCCEEDED","FAILED"));
            awaitLockWait("%from tasks where id%for update%");
            awaitLeaseExpiration(lease.id());
            blocker.commit();

            assertFalse(result.get(5,java.util.concurrent.TimeUnit.SECONDS));
            assertEquals("PENDING",service.get("alice",lease.id()).status());
            var outbox=db.queryForMap("select state,lease_token,attempts from outbox where task_id=?",lease.id());
            assertEquals("READY",outbox.get("state"));
            assertEquals(lease.token(),outbox.get("lease_token"));
            assertEquals(lease.attempts(),((Number)outbox.get("attempts")).intValue());
            assertEquals(0,db.queryForObject("select count(*) from result_conflicts where task_id=?",Integer.class,lease.id()));
            assertEquals(0,db.queryForObject("select count(*) from exchange_events where task_id=? and event='RESULT_CONFLICT_REQUIRES_REVIEW'",Integer.class,lease.id()));
        } finally {
            blocker.close();
            executor.shutdownNow();
        }
    }

    @Test void finishRechecksLeaseAfterWaitingForOutboxLock() throws Exception {
        var lease=freshLease();
        db.update("update outbox set lease_until=clock_timestamp()+interval '1200 milliseconds' where task_id=?",lease.id());
        var blocker=dataSource.getConnection();
        blocker.setAutoCommit(false);
        try (var statement=blocker.prepareStatement("select task_id from outbox where task_id=? for update")) {
            statement.setObject(1,lease.id());
            statement.executeQuery().close();
        }
        var executor=Executors.newSingleThreadExecutor();
        try {
            var result=executor.submit(()->service.finish(lease,false));
            awaitLockWait("%from outbox where task_id%for update%");
            awaitLeaseExpiration(lease.id());
            blocker.commit();
            result.get(5,java.util.concurrent.TimeUnit.SECONDS);

            var outbox=db.queryForMap("select state,lease_token,attempts,failure_reason from outbox where task_id=?",lease.id());
            assertEquals("READY",outbox.get("state"));
            assertEquals(lease.token(),outbox.get("lease_token"));
            assertEquals(lease.attempts(),((Number)outbox.get("attempts")).intValue());
            assertNull(outbox.get("failure_reason"));
            assertEquals(0,db.queryForObject("select count(*) from exchange_events where task_id=? and event='AMBIGUOUS_RETRY'",Integer.class,lease.id()));
        } finally {
            blocker.close();
            executor.shutdownNow();
        }
    }

    @Test void rejectRechecksLeaseAfterWaitingForOutboxLock() throws Exception {
        var lease=freshLease();
        db.update("update outbox set lease_until=clock_timestamp()+interval '1200 milliseconds' where task_id=?",lease.id());
        var blocker=dataSource.getConnection();
        blocker.setAutoCommit(false);
        try (var statement=blocker.prepareStatement("select task_id from outbox where task_id=? for update")) {
            statement.setObject(1,lease.id());
            statement.executeQuery().close();
        }
        var executor=Executors.newSingleThreadExecutor();
        try {
            var result=executor.submit(()->service.reject(lease));
            awaitLockWait("%from outbox where task_id%for update%");
            awaitLeaseExpiration(lease.id());
            blocker.commit();
            result.get(5,java.util.concurrent.TimeUnit.SECONDS);

            var outbox=db.queryForMap("select state,lease_token,attempts,failure_reason from outbox where task_id=?",lease.id());
            assertEquals("READY",outbox.get("state"));
            assertEquals(lease.token(),outbox.get("lease_token"));
            assertEquals(lease.attempts(),((Number)outbox.get("attempts")).intValue());
            assertNull(outbox.get("failure_reason"));
            assertEquals(0,db.queryForObject("select count(*) from exchange_events where task_id=? and event='INVALID_RESULT_REQUIRES_REVIEW'",Integer.class,lease.id()));
        } finally {
            blocker.close();
            executor.shutdownNow();
        }
    }

    @Test void contradictoryResultAuditIncludesActualDeliveryTransition() throws Exception {
        var task=freshTask();
        var lease=service.claim();
        assertEquals(task.id(),lease.id());
        assertTrue(service.rejectContradictoryBatch(lease,1,"SUCCEEDED","FAILED"));

        var event=operatorHistoryEvent(task.id(),"RESULT_CONFLICT_REQUIRES_REVIEW");
        var details=(java.util.Map<?,?>)event.get("details");
        assertEquals("READY",details.get("oldDeliveryState"));
        assertEquals("REVIEW",details.get("newDeliveryState"));
        assertEquals("PENDING",details.get("oldBusinessStatus"));
        assertEquals("PENDING",details.get("newBusinessStatus"));
        assertEquals("CONTRADICTORY_RESULT_BATCH",details.get("reason"));
    }

    private void awaitLockWait(String queryPattern) throws Exception {
        long deadline=System.nanoTime()+java.util.concurrent.TimeUnit.SECONDS.toNanos(5);
        while(System.nanoTime()<deadline) {
            Integer waiting=db.queryForObject("select count(*) from pg_stat_activity where wait_event_type='Lock' and query like ?",Integer.class,queryPattern);
            if(waiting!=null && waiting>0) return;
            Thread.sleep(10);
        }
        fail("Timed out waiting for PostgreSQL lock wait for query " + queryPattern);
    }

    private void awaitLeaseExpiration(UUID id) throws Exception {
        long deadline=System.nanoTime()+java.util.concurrent.TimeUnit.SECONDS.toNanos(5);
        while(System.nanoTime()<deadline) {
            Boolean expired=db.queryForObject("select lease_until<=clock_timestamp() from outbox where task_id=?",Boolean.class,id);
            if(Boolean.TRUE.equals(expired)) return;
            Thread.sleep(10);
        }
        fail("Timed out waiting for lease expiration for operationId " + id);
    }

    @Test void expiredLastLeaseClearsTokenAndRecordsReason() {
        var old=freshLease();
        db.update("update outbox set attempts=5,lease_until=now()-interval '1 second' where task_id=?",old.id());
        service.claim();
        var row=db.queryForMap("select state,lease_token,failure_reason from outbox where task_id=?",old.id());
        assertEquals("FAILED",row.get("state"));
        assertNull(row.get("lease_token"));
        assertEquals("LAST_LEASE_EXPIRED",row.get("failure_reason"));
        assertFalse(service.complete(old,1,"SUCCEEDED"));
    }

    @Test void conflictIsCommittedWithAttemptAndVersions() {
        var lease=freshLease();
        assertTrue(service.complete(lease,2,"SUCCEEDED"));
        db.update("update outbox set state='READY',next_attempt=now() where task_id=?",lease.id());
        lease=service.claim();
        assertTrue(service.complete(lease,2,"FAILED"));
        var conflict=db.queryForMap("select * from result_conflicts where task_id=?",lease.id());
        assertEquals(lease.attempts(),((Number)conflict.get("attempt")).intValue());
        assertEquals(2L,((Number)conflict.get("current_version")).longValue());
        assertEquals(2L,((Number)conflict.get("incoming_version")).longValue());
        assertEquals("SAME_VERSION_DIFFERENT_RESULT",conflict.get("reason"));
        assertEquals("SUCCEEDED",service.get("alice",lease.id()).status());
        assertEquals("REVIEW",db.queryForObject("select state from outbox where task_id=?",String.class,lease.id()));
    }

    @Test void failureWhileWritingHistoryRollsBackResultAndOutbox() {
        var lease=freshLease();
        db.execute("alter table exchange_events add constraint test_reject_result check (event <> 'RESULT_APPLY') not valid");
        try {
            assertThrows(Exception.class,()->service.complete(lease,1,"SUCCEEDED"));
            assertEquals("PENDING",service.get("alice",lease.id()).status());
            assertEquals("READY",db.queryForObject("select state from outbox where task_id=?",String.class,lease.id()));
            assertEquals(lease.token(),db.queryForObject("select lease_token from outbox where task_id=?",UUID.class,lease.id()));
        } finally { db.execute("alter table exchange_events drop constraint test_reject_result"); }
    }

    @Test void operatorHistoryReturnsStructuredDetailsForAppliedResult() throws Exception {
        var task=freshTask();
        var server=resultServer(task.id()+"|1|SUCCEEDED");
        try {
            assertTrue(new DeliveryWorker(service,"http://127.0.0.1:"+server.getAddress().getPort(),false).deliverOne());
            var event=operatorHistoryEvent(task.id(),"RESULT_APPLY");
            assertEquals(task.id().toString(),event.get("task_id"));
            assertEquals("executor",event.get("actor"));
            assertNotNull(event.get("created_at"));
            var details=(java.util.Map<?,?>)event.get("details");
            assertNotNull(details);
            assertEquals("PENDING",details.get("oldBusinessStatus"));
            assertEquals("SUCCEEDED",details.get("newBusinessStatus"));
            assertEquals(0L,((Number)details.get("oldResultVersion")).longValue());
            assertEquals(1L,((Number)details.get("newResultVersion")).longValue());
            assertEquals("READY",details.get("oldDeliveryState"));
            assertEquals("DONE",details.get("newDeliveryState"));
            assertEquals("APPLY",details.get("resultDecision"));
        } finally { server.stop(0); }
    }

    @Test void operatorHistoryReturnsStructuredDetailsForReconciliationDecision() throws Exception {
        var task=freshTask();
        String body="{\"operationId\":\""+task.id()+"\",\"status\":\"SUCCEEDED\",\"version\":1,\"executions\":1}";
        var server=com.sun.net.httpserver.HttpServer.create(new java.net.InetSocketAddress("127.0.0.1",0),0);
        server.createContext("/operations/",exchange->{byte[] bytes=body.getBytes(java.nio.charset.StandardCharsets.UTF_8);exchange.getResponseHeaders().set("Content-Type","application/json");exchange.sendResponseHeaders(200,bytes.length);try(var out=exchange.getResponseBody()){out.write(bytes);}});
        server.start();
        Object previous=org.springframework.test.util.ReflectionTestUtils.getField(reconciliation,"client");
        org.springframework.test.util.ReflectionTestUtils.setField(reconciliation,"client",org.springframework.web.client.RestClient.create("http://localhost:"+server.getAddress().getPort()));
        try {
            String base="http://localhost:"+port+"/api/operator/tasks/"+task.id();
            assertEquals(200,operatorPost(base+"/reconcile","operator:demo-operator",null));
            UUID snapshot=db.queryForObject("select id from reconciliations where task_id=? order by observed_at desc,id desc limit 1",UUID.class,task.id());
            assertEquals(200,operatorPost(base+"/reconciliations/"+snapshot+"/apply","operator:demo-operator",null));
            var event=operatorHistoryEvent(task.id(),"RECONCILIATION_DECISION_APPLY");
            assertEquals("operator",event.get("actor"));
            var details=(java.util.Map<?,?>)event.get("details");
            assertNotNull(details);
            assertEquals("PENDING",details.get("oldBusinessStatus"));
            assertEquals("SUCCEEDED",details.get("newBusinessStatus"));
            assertEquals(0L,((Number)details.get("oldResultVersion")).longValue());
            assertEquals(1L,((Number)details.get("newResultVersion")).longValue());
            assertEquals("READY",details.get("oldDeliveryState"));
            assertEquals("DONE",details.get("newDeliveryState"));
            assertEquals(snapshot.toString(),details.get("reconciliationId"));
        } finally {
            org.springframework.test.util.ReflectionTestUtils.setField(reconciliation,"client",previous);
            server.stop(0);
        }
    }

    @Test void operatorHistoryReturnsStructuredDetailsForManualRecovery() throws Exception {
        var task=freshTask();
        db.update("update outbox set state='FAILED',attempts=5,attempt_limit=5,failure_reason='LAST_LEASE_EXPIRED',lease_token=null,lease_until=null where task_id=?",task.id());
        String key="audit-recovery-"+UUID.randomUUID();
        assertEquals(200,operatorPost("http://localhost:"+port+"/api/operator/tasks/"+task.id()+"/retry","operator:demo-operator",key));
        var event=operatorHistoryEvent(task.id(),"MANUAL_RECOVERY");
        assertEquals(task.id().toString(),event.get("task_id"));
        assertEquals("operator",event.get("actor"));
        assertNotNull(event.get("created_at"));
        var details=(java.util.Map<?,?>)event.get("details");
        assertNotNull(details);
        assertEquals("FAILED",details.get("oldDeliveryState"));
        assertEquals("READY",details.get("newDeliveryState"));
        assertEquals(5L,((Number)details.get("attemptLimitBefore")).longValue());
        assertEquals(10L,((Number)details.get("attemptLimitAfter")).longValue());
        assertEquals("LAST_LEASE_EXPIRED",details.get("reason"));
        assertFalse(details.containsKey("commandKey"),"idempotency keys must not be exposed in history");
    }

    @Test void operatorHistoryDistinguishesDuplicateStaleAndConflictingResults() throws Exception {
        var task=freshTask();
        assertTrue(service.complete(service.claim(),2,"SUCCEEDED"));
        db.update("update outbox set state='READY',next_attempt=now() where task_id=?",task.id());
        assertTrue(service.complete(service.claim(),2,"SUCCEEDED"));
        db.update("update outbox set state='READY',next_attempt=now() where task_id=?",task.id());
        assertTrue(service.complete(service.claim(),1,"FAILED"));
        db.update("update outbox set state='READY',next_attempt=now() where task_id=?",task.id());
        assertTrue(service.complete(service.claim(),2,"FAILED"));
        assertEquals("SUCCEEDED",service.get("alice",task.id()).status());
        assertEquals(2,service.get("alice",task.id()).version());

        var duplicate=(java.util.Map<?,?>)operatorHistoryEvent(task.id(),"RESULT_DUPLICATE").get("details");
        assertEquals("SUCCEEDED",duplicate.get("oldBusinessStatus"));
        assertEquals("SUCCEEDED",duplicate.get("newBusinessStatus"));
        assertEquals("SUCCEEDED",duplicate.get("incomingBusinessStatus"));
        assertEquals(2L,((Number)duplicate.get("oldResultVersion")).longValue());
        assertEquals(2L,((Number)duplicate.get("newResultVersion")).longValue());

        var stale=(java.util.Map<?,?>)operatorHistoryEvent(task.id(),"RESULT_STALE").get("details");
        assertEquals("SUCCEEDED",stale.get("oldBusinessStatus"));
        assertEquals("SUCCEEDED",stale.get("newBusinessStatus"));
        assertEquals("FAILED",stale.get("incomingBusinessStatus"));
        assertEquals(1L,((Number)stale.get("incomingResultVersion")).longValue());

        var conflict=(java.util.Map<?,?>)operatorHistoryEvent(task.id(),"RESULT_CONFLICT").get("details");
        assertEquals("SUCCEEDED",conflict.get("oldBusinessStatus"));
        assertEquals("SUCCEEDED",conflict.get("newBusinessStatus"));
        assertEquals("FAILED",conflict.get("incomingBusinessStatus"));
        assertEquals("REVIEW",conflict.get("newDeliveryState"));
        assertEquals("SAME_VERSION_DIFFERENT_RESULT",conflict.get("reason"));
    }

    private java.util.Map<?,?> operatorHistoryEvent(UUID taskId,String eventName) throws Exception {
        var response=api("GET","http://localhost:"+port+"/api/operator/tasks/"+taskId,"operator:demo-operator",null);
        assertEquals(200,response.statusCode(),response.body());
        var detail=tools.jackson.databind.json.JsonMapper.builder().build().readValue(response.body(),java.util.Map.class);
        var history=(java.util.List<?>)detail.get("history");
        return history.stream().map(item->(java.util.Map<?,?>)item).filter(item->eventName.equals(item.get("event"))).reduce((first,second)->second).orElseThrow();
    }

    private java.net.http.HttpResponse<String> post(String key,String title) throws Exception {
        return java.net.http.HttpClient.newHttpClient().send(java.net.http.HttpRequest.newBuilder(java.net.URI.create("http://localhost:"+port+"/api/tasks"))
                .header("Authorization","Basic "+java.util.Base64.getEncoder().encodeToString("alice:demo-alice".getBytes()))
                .header("Content-Type","application/json").header("Idempotency-Key",key)
                .POST(java.net.http.HttpRequest.BodyPublishers.ofString("{\"title\":\""+title+"\"}")).build(),java.net.http.HttpResponse.BodyHandlers.ofString());
    }

    @Test void repeatedPostThroughHttp() throws Exception {
        String key=UUID.randomUUID().toString();
        var first=post(key,"HTTP");
        assertEquals(200,first.statusCode());
        assertEquals(first.body(),post(key,"HTTP").body());
        assertEquals(409,post(key,"Changed").statusCode());
    }

    @Test void expiredLeaseAndLostReplyKeepSingleExternalExecution() throws Exception {
        // Isolate this delivery test from other pending operations.
        db.update("update outbox set next_attempt=now()+interval '1 day'");
        String key=UUID.randomUUID().toString();
        assertEquals(200,post(key,"Recover").statusCode());
        var task=service.create("alice",key,"Recover");
        var abandoned=service.claim();
        assertEquals(task.id(),abandoned.id());
        assertEquals(409,operatorPost("http://localhost:"+port+"/api/operator/tasks/"+task.id()+"/retry","operator:demo-operator",UUID.randomUUID().toString()));
        db.update("update outbox set lease_until=now()-interval '1 second' where task_id=?",task.id());
        var builder=new ProcessBuilder(System.getProperty("java.home")+"/bin/java", "-cp",System.getProperty("java.class.path"),
                "ru.secreate.exchange.emulator.EmulatorMain","0").redirectError(ProcessBuilder.Redirect.INHERIT);
        try(var c=dataSource.getConnection()) {
            builder.environment().put("EXECUTOR_DB_URL",c.getMetaData().getURL());
            builder.environment().put("EXECUTOR_DB_USER",c.getMetaData().getUserName());
        }
        builder.environment().put("EXECUTOR_DB_PASSWORD","test");
        Process process=builder.start();
        try {
            String ready=java.util.concurrent.CompletableFuture.supplyAsync(() -> {
                try { return new java.io.BufferedReader(new java.io.InputStreamReader(process.getInputStream())).readLine(); }
                catch(java.io.IOException e) { throw new java.io.UncheckedIOException(e); }
            }).get(15,java.util.concurrent.TimeUnit.SECONDS);
            assertNotNull(ready);assertTrue(ready.startsWith("READY "),ready);
            String url="http://localhost:"+ready.substring(6);
            org.springframework.test.util.ReflectionTestUtils.setField(reconciliation,"client",org.springframework.web.client.RestClient.create(url));
            var client=java.net.http.HttpClient.newHttpClient();
            var invalid=client.send(java.net.http.HttpRequest.newBuilder(java.net.URI.create(url+"/operations/invalid")).GET().build(),java.net.http.HttpResponse.BodyHandlers.ofString());
            assertEquals(400,invalid.statusCode());
            String another=UUID.randomUUID().toString();
            var original=java.net.http.HttpRequest.newBuilder(java.net.URI.create(url+"/operations/"+another)).POST(java.net.http.HttpRequest.BodyPublishers.ofString("one")).build();
            assertEquals(200,client.send(original,java.net.http.HttpResponse.BodyHandlers.ofString()).statusCode());
            db.update("update executor.executions set result_version=7,result_status='FAILED' where id=?",UUID.fromString(another));
            assertEquals(another+"|7|FAILED",client.send(original,java.net.http.HttpResponse.BodyHandlers.ofString()).body());
            var stored=client.send(java.net.http.HttpRequest.newBuilder(java.net.URI.create(url+"/operations/"+another)).GET().build(),java.net.http.HttpResponse.BodyHandlers.ofString());
            assertTrue(stored.body().contains("\"version\":7"));
            assertTrue(stored.body().contains("\"status\":\"FAILED\""));
            assertTrue(stored.body().contains("\"executions\":1"));
            var reconcileTask=service.create("alice",UUID.randomUUID().toString(),"Observe");
            var externalRequest=java.net.http.HttpRequest.newBuilder(java.net.URI.create(url+"/operations/"+reconcileTask.id())).POST(java.net.http.HttpRequest.BodyPublishers.ofString("Observe")).build();
            assertEquals(200,client.send(externalRequest,java.net.http.HttpResponse.BodyHandlers.ofString()).statusCode());
            String base="http://localhost:"+port+"/api/operator/tasks/"+reconcileTask.id();
            assertEquals(403,operatorPost(base+"/reconcile","alice:demo-alice",null));
            assertEquals(200,operatorPost(base+"/reconcile","operator:demo-operator",null));
            var snapshot=db.queryForMap("select * from reconciliations where task_id=? order by observed_at desc limit 1",reconcileTask.id());
            assertEquals("DIFFERENT",snapshot.get("outcome"));
            assertEquals("operator",snapshot.get("actor"));
            assertNotNull(snapshot.get("observed_at"));
            assertEquals("PENDING",snapshot.get("local_status"));
            assertEquals("SUCCEEDED",snapshot.get("external_status"));
            assertEquals(1L,((Number)snapshot.get("external_version")).longValue());
            db.update("update tasks set result_version=2,status='FAILED' where id=?",reconcileTask.id());
            assertEquals(409,operatorPost(base+"/reconciliations/"+snapshot.get("id")+"/apply","operator:demo-operator",null));
            assertEquals("FAILED",service.get("alice",reconcileTask.id()).status());
            db.update("update tasks set result_version=0,status='PENDING' where id=?",reconcileTask.id());
            assertEquals(200,operatorPost(base+"/reconcile","operator:demo-operator",null));
            UUID staleExternal=db.queryForObject("select id from reconciliations where task_id=? order by observed_at desc limit 1",UUID.class,reconcileTask.id());
            db.update("update executor.executions set result_version=2 where id=?",reconcileTask.id());
            assertEquals(409,operatorPost(base+"/reconciliations/"+staleExternal+"/apply","operator:demo-operator",null));
            assertEquals(200,operatorPost(base+"/reconcile","operator:demo-operator",null));
            UUID fresh=db.queryForObject("select id from reconciliations where task_id=? order by observed_at desc limit 1",UUID.class,reconcileTask.id());
            assertEquals(200,operatorPost(base+"/reconciliations/"+fresh+"/apply","operator:demo-operator",null));
            assertEquals(2,service.get("alice",reconcileTask.id()).version());
            assertEquals("DONE",db.queryForObject("select state from outbox where task_id=?",String.class,reconcileTask.id()));
            assertEquals("operator",db.queryForObject("select decided_by from reconciliations where id=?",String.class,fresh));
            assertEquals(409,operatorPost(base+"/retry","operator:demo-operator",UUID.randomUUID().toString()));
            assertEquals(200,operatorPost(base+"/reconcile","operator:demo-operator",null));
            assertEquals("MATCH",db.queryForObject("select outcome from reconciliations where task_id=? order by observed_at desc limit 1",String.class,reconcileTask.id()));
            var missing=service.create("alice",UUID.randomUUID().toString(),"Missing");
            String missingBase="http://localhost:"+port+"/api/operator/tasks/"+missing.id();
            assertEquals(200,operatorPost(missingBase+"/reconcile","operator:demo-operator",null));
            assertEquals("ABSENT",db.queryForObject("select outcome from reconciliations where task_id=? order by observed_at desc limit 1",String.class,missing.id()));
            var other=service.create("bob",UUID.randomUUID().toString(),"Out of scope");
            assertEquals(404,operatorPost("http://localhost:"+port+"/api/operator/tasks/"+other.id()+"/reconcile","operator:demo-operator",null));
            assertEquals(404,operatorPost("http://localhost:"+port+"/api/operator/tasks/"+other.id()+"/retry","operator:demo-operator",UUID.randomUUID().toString()));
            assertEquals(403,operatorPost(base+"/retry","alice:demo-alice",UUID.randomUUID().toString()));
            var mismatch=java.net.http.HttpRequest.newBuilder(java.net.URI.create(url+"/operations/"+another)).POST(java.net.http.HttpRequest.BodyPublishers.ofString("two")).build();
            assertEquals(409,client.send(mismatch,java.net.http.HttpResponse.BodyHandlers.ofString()).statusCode());
            db.update("update outbox set next_attempt=now()+interval '1 day' where task_id<>?",task.id());
            db.execute("alter table executor.executions rename to unavailable_executions");
            try {
                var unavailable=client.send(java.net.http.HttpRequest.newBuilder(java.net.URI.create(url+"/operations/"+task.id())).GET().build(),java.net.http.HttpResponse.BodyHandlers.ofString());
                assertEquals(503,unavailable.statusCode());
                assertTrue(new DeliveryWorker(service,url,false).deliverOne());
                assertEquals("READY",db.queryForObject("select state from outbox where task_id=?",String.class,task.id()));
                assertEquals(200,operatorPost(missingBase+"/reconcile","operator:demo-operator",null));
                assertEquals("UNAVAILABLE",db.queryForObject("select outcome from reconciliations where task_id=? order by observed_at desc limit 1",String.class,missing.id()));
            } finally { db.execute("alter table executor.unavailable_executions rename to executions"); }
            db.update("update outbox set next_attempt=now() where task_id=?",task.id());
            client.send(java.net.http.HttpRequest.newBuilder(java.net.URI.create(url+"/fault/drop-next")).POST(java.net.http.HttpRequest.BodyPublishers.noBody()).build(),java.net.http.HttpResponse.BodyHandlers.discarding());
            var worker=new DeliveryWorker(service,url,false);
            assertTrue(worker.deliverOne());
            assertEquals("PENDING",service.get("alice",task.id()).status());
            assertEquals("READY",db.queryForObject("select state from outbox where task_id=?",String.class,task.id()));
            String lostBase="http://localhost:"+port+"/api/operator/tasks/"+task.id();
            assertEquals(200,operatorPost(lostBase+"/reconcile","operator:demo-operator",null));
            assertEquals("DIFFERENT",db.queryForObject("select outcome from reconciliations where task_id=? order by observed_at desc limit 1",String.class,task.id()));
            String recovery="http://localhost:"+port+"/api/operator/tasks/"+task.id()+"/retry";
            String command=UUID.randomUUID().toString();
            try(var pool=Executors.newFixedThreadPool(4)) {
                var responses=new java.util.ArrayList<java.util.concurrent.Future<Integer>>();
                for(int i=0;i<8;i++) responses.add(pool.submit(()->operatorPost(recovery,"operator:demo-operator",command)));
                for(var response:responses) assertEquals(200,response.get());
            }
            assertEquals(200,operatorPost(recovery,"operator:demo-operator",command));
            assertEquals(1,db.queryForObject("select count(*) from exchange_events where task_id=? and event='MANUAL_RECOVERY'",Integer.class,task.id()));
            db.update("update outbox set next_attempt=now() where task_id=?",task.id());
            // A newly constructed worker represents restart; no in-memory delivery state is reused.
            assertTrue(new DeliveryWorker(service,url,false).deliverOne());
            assertEquals("SUCCEEDED",service.get("alice",task.id()).status());
            assertEquals("DONE",db.queryForObject("select state from outbox where task_id=?",String.class,task.id()));
            service.finish(abandoned,false);
            assertEquals("DONE",db.queryForObject("select state from outbox where task_id=?",String.class,task.id()));
            var count=client.send(java.net.http.HttpRequest.newBuilder(java.net.URI.create(url+"/operations/"+task.id())).GET().build(),java.net.http.HttpResponse.BodyHandlers.ofString());
            assertTrue(count.body().contains("\"executions\":1"));
            assertTrue(count.body().contains("\"version\":1"));
            assertTrue(count.body().contains("\"status\":\"SUCCEEDED\""));
        } finally { process.destroyForcibly();process.waitFor(); }
    }

    @Test void emulatorFaultModesAreDeterministicAndRecoverable() throws Exception {
        db.update("update outbox set next_attempt=now()+interval '1 day'");
        var builder=new ProcessBuilder(System.getProperty("java.home")+"/bin/java", "-cp",System.getProperty("java.class.path"),
                "ru.secreate.exchange.emulator.EmulatorMain","0").redirectError(ProcessBuilder.Redirect.INHERIT);
        try(var c=dataSource.getConnection()) {
            builder.environment().put("EXECUTOR_DB_URL",c.getMetaData().getURL());
            builder.environment().put("EXECUTOR_DB_USER",c.getMetaData().getUserName());
        }
        builder.environment().put("EXECUTOR_DB_PASSWORD","test");
        Process process=builder.start();
        try {
            String ready=java.util.concurrent.CompletableFuture.supplyAsync(() -> {
                try { return new java.io.BufferedReader(new java.io.InputStreamReader(process.getInputStream())).readLine(); }
                catch(java.io.IOException e) { throw new java.io.UncheckedIOException(e); }
            }).get(15,java.util.concurrent.TimeUnit.SECONDS);
            assertNotNull(ready);assertTrue(ready.startsWith("READY "),ready);
            String base="http://localhost:"+ready.substring(6);
            var http=java.net.http.HttpClient.newHttpClient();
            var worker=new DeliveryWorker(service,base,false);

            var unavailable=freshTask();
            assertEquals(204,mode(http,base,"PUT","/fault-modes/unavailable"));
            var configuredMode=http.send(java.net.http.HttpRequest.newBuilder(java.net.URI.create(base+"/fault-modes")).GET().build(),java.net.http.HttpResponse.BodyHandlers.ofString());
            assertEquals(200,configuredMode.statusCode());
            assertTrue(configuredMode.body().contains("\"unavailable\":true"));
            assertTrue(worker.deliverOne());
            assertEquals("PENDING",service.get("alice",unavailable.id()).status());
            assertEquals("READY",db.queryForObject("select state from outbox where task_id=?",String.class,unavailable.id()));
            assertEquals(404,externalGet(http,base,unavailable.id()).statusCode());
            assertEquals(204,mode(http,base,"DELETE","/fault-modes"));
            var resetMode=http.send(java.net.http.HttpRequest.newBuilder(java.net.URI.create(base+"/fault-modes")).GET().build(),java.net.http.HttpResponse.BodyHandlers.ofString());
            assertTrue(resetMode.body().contains("\"unavailable\":false"));
            db.update("update outbox set next_attempt=now() where task_id=?",unavailable.id());
            assertTrue(worker.deliverOne());
            assertEquals(1,externalExecutions(http,base,unavailable.id()));

            var dropped=freshTask();
            assertEquals(204,mode(http,base,"PUT","/fault-modes/drop-after-save"));
            assertTrue(worker.deliverOne());
            assertEquals("PENDING",service.get("alice",dropped.id()).status());
            assertEquals(1,externalExecutions(http,base,dropped.id()));
            var externalCommittedAt = db.queryForObject(
                    "select executed_at from executor.executions where id=?", java.sql.Timestamp.class, dropped.id());
            assertNotNull(externalCommittedAt, "the executor ledger must record its commit time");
            db.update("update outbox set next_attempt=now() where task_id=?",dropped.id());
            assertTrue(worker.deliverOne());
            assertEquals("SUCCEEDED",service.get("alice",dropped.id()).status());
            assertEquals(1,externalExecutions(http,base,dropped.id()));
            assertEquals(externalCommittedAt, db.queryForObject(
                    "select executed_at from executor.executions where id=?", java.sql.Timestamp.class, dropped.id()),
                    "idempotent redelivery must preserve the first external execution time");

            var duplicate=freshTask();
            assertEquals(204,mode(http,base,"PUT","/fault-modes/duplicate-result"));
            assertTrue(worker.deliverOne());
            assertEquals("SUCCEEDED",service.get("alice",duplicate.id()).status());
            assertEquals(1,service.get("alice",duplicate.id()).version());
            assertEquals(1,db.queryForObject("select count(*) from exchange_events where task_id=? and event='RESULT_APPLY'",Integer.class,duplicate.id()));
            assertEquals(1,externalExecutions(http,base,duplicate.id()));

            var delayed=freshTask();
            assertEquals(204,mode(http,base,"PUT","/fault-modes/delayed-result?delayMs=1800"));
            try(var pool=Executors.newSingleThreadExecutor()) {
                var delivery=pool.submit(worker::deliverOne);
                long waitUntil=System.nanoTime()+java.util.concurrent.TimeUnit.SECONDS.toNanos(3);
                while(db.queryForObject("select lease_token is not null from outbox where task_id=?",Boolean.class,delayed.id())==false && System.nanoTime()<waitUntil)
                    Thread.sleep(20);
                var card=api("GET","http://localhost:"+port+"/api/operator/tasks/"+delayed.id(),"operator:demo-operator",null);
                assertEquals(200,card.statusCode());
                assertTrue(card.body().contains("\"delivery_state\":\"READY\""),card.body());
                assertTrue(card.body().contains("\"business_status\":\"PENDING\""),card.body());
                assertFalse(delivery.isDone(),"the delayed result must still be in flight");
                assertTrue(delivery.get(5,java.util.concurrent.TimeUnit.SECONDS));
            }
            assertEquals("SUCCEEDED",service.get("alice",delayed.id()).status());
            assertEquals(1,externalExecutions(http,base,delayed.id()));
            assertEquals(204,mode(http,base,"DELETE","/fault-modes"));
        } finally { process.destroyForcibly();process.waitFor(); }
    }

    private int mode(java.net.http.HttpClient client,String base,String method,String path) throws Exception {
        var request=java.net.http.HttpRequest.newBuilder(java.net.URI.create(base+path));
        if(method.equals("PUT")) request.PUT(java.net.http.HttpRequest.BodyPublishers.noBody());
        else request.DELETE();
        return client.send(request.build(),java.net.http.HttpResponse.BodyHandlers.ofString()).statusCode();
    }

    private java.net.http.HttpResponse<String> externalGet(java.net.http.HttpClient client,String base,UUID id) throws Exception {
        return client.send(java.net.http.HttpRequest.newBuilder(java.net.URI.create(base+"/operations/"+id)).GET().build(),java.net.http.HttpResponse.BodyHandlers.ofString());
    }

    private int externalExecutions(java.net.http.HttpClient client,String base,UUID id) throws Exception {
        var response=externalGet(client,base,id);
        assertEquals(200,response.statusCode(),response.body());
        return ((Number)tools.jackson.databind.json.JsonMapper.builder().build().readTree(response.body()).get("executions").numberValue()).intValue();
    }

    private int operatorPost(String url,String login,String key) throws Exception {
        var builder=java.net.http.HttpRequest.newBuilder(java.net.URI.create(url)).header("Authorization","Basic "+java.util.Base64.getEncoder().encodeToString(login.getBytes(java.nio.charset.StandardCharsets.UTF_8)));
        if(key!=null) builder.header("Idempotency-Key",key);
        return java.net.http.HttpClient.newHttpClient().send(builder.POST(java.net.http.HttpRequest.BodyPublishers.noBody()).build(),java.net.http.HttpResponse.BodyHandlers.ofString()).statusCode();
    }

    @Test void repeatedCreateAndConflict() {
        String key = UUID.randomUUID().toString();
        var first = service.create("alice", key, "Work");
        assertEquals(first.id(), service.create("alice", key, "Work").id());
        assertThrows(org.springframework.web.server.ResponseStatusException.class,
                () -> service.create("alice", key, "Other"));
        assertEquals(1, db.queryForObject("select count(*) from outbox where task_id=?", Integer.class, first.id()));
    }

    @Test void concurrentPostHasOneTaskAndOutbox() throws Exception {
        String key=UUID.randomUUID().toString();
        try(var pool=Executors.newFixedThreadPool(4)) {
            var requests=new java.util.ArrayList<java.util.concurrent.Future<String>>();
            for(int i=0;i<8;i++) requests.add(pool.submit(() -> {
                var response=post(key,"Concurrent"); assertEquals(200,response.statusCode()); return response.body();
            }));
            var bodies=new java.util.HashSet<String>();
            for(var request:requests) bodies.add(request.get());
            assertEquals(1,bodies.size());
        }
        assertEquals(1,db.queryForObject("select count(*) from tasks where request_key=?",Integer.class,key));
    }

    @Test void invalidResultLeavesStateUnchanged() {
        var lease=freshLease();
        assertThrows(IllegalArgumentException.class,()->service.complete(lease,1,"ACKNOWLEDGED"));
        assertEquals("PENDING",service.get("alice",lease.id()).status());
        assertThrows(org.springframework.web.server.ResponseStatusException.class,()->service.get("bob",lease.id()));
    }

    @Test void concurrentVersionsCannotRollBackNewResult() throws Exception {
        var lease = freshLease();
        try (var pool = Executors.newFixedThreadPool(2)) {
            var a = pool.submit(() -> service.complete(lease, 2, "SUCCEEDED"));
            var b = pool.submit(() -> service.complete(lease, 1, "FAILED"));
            assertNotEquals(a.get(), b.get());
        }
        db.update("update outbox set state='READY',next_attempt=now() where task_id=?",lease.id());
        var newer=service.claim();
        assertEquals(lease.id(),newer.id());
        assertTrue(service.complete(newer, 2, "SUCCEEDED"));
        db.update("update outbox set state='READY',next_attempt=now() where task_id=?",lease.id());
        var stale=service.claim();
        assertTrue(service.complete(stale, 1, "FAILED"));
        assertEquals(2, service.get("alice", lease.id()).version());
        assertEquals("SUCCEEDED", service.get("alice", lease.id()).status());
    }

    @Test void interruptedWorkerDoesNotClaimBeforeItsFirstDelivery() {
        var task = freshTask();
        var worker = new DeliveryWorker(service, "http://127.0.0.1:1", true, 3);
        Thread.currentThread().interrupt();
        try {
            worker.tick();
            assertTrue(Thread.currentThread().isInterrupted(), "worker must preserve the caller interrupt flag");
            assertEquals(0, db.queryForObject("select attempts from outbox where task_id=?", Integer.class, task.id()));
            assertEquals(0, db.queryForObject("select count(*) from exchange_events where task_id=? and event like 'ATTEMPT_%'", Integer.class, task.id()));
        } finally {
            Thread.interrupted();
        }
    }

    @Test void interruptDuringHttpFinalizesAttemptAndStopsFurtherClaims() throws Exception {
        var first = freshTask();
        var second = freshTask();
        db.update("update outbox set next_attempt=now()-interval '1 second' where task_id=?", first.id());
        db.update("update outbox set next_attempt=now() where task_id=?", second.id());
        var entered = new java.util.concurrent.CountDownLatch(1);
        var release = new java.util.concurrent.CountDownLatch(1);
        var calls = new java.util.concurrent.atomic.AtomicInteger();
        var emulator = com.sun.net.httpserver.HttpServer.create(new java.net.InetSocketAddress("127.0.0.1", 0), 0);
        emulator.createContext("/operations/", exchange -> {
            int call = calls.incrementAndGet();
            String id = exchange.getRequestURI().getPath().substring("/operations/".length());
            if (call == 1) {
                entered.countDown();
                try { release.await(5, java.util.concurrent.TimeUnit.SECONDS); }
                catch (InterruptedException interrupted) { Thread.currentThread().interrupt(); }
            }
            byte[] response = (id + "|1|SUCCEEDED").getBytes(java.nio.charset.StandardCharsets.UTF_8);
            try {
                exchange.getResponseHeaders().set("Content-Type", "text/plain; charset=utf-8");
                exchange.sendResponseHeaders(200, response.length);
                exchange.getResponseBody().write(response);
            } catch (java.io.IOException ignored) {
                // The interrupted client may have closed this response; the server-side request is still observed.
            } finally { exchange.close(); }
        });
        emulator.start();
        var worker = new DeliveryWorker(service, "http://127.0.0.1:" + emulator.getAddress().getPort(), true, 3);
        var interruptObserved = new java.util.concurrent.atomic.AtomicBoolean();
        var workerThread = new Thread(() -> {
            worker.tick();
            interruptObserved.set(Thread.currentThread().isInterrupted());
        }, "delivery-interrupt-regression");
        try {
            workerThread.start();
            assertTrue(entered.await(5, java.util.concurrent.TimeUnit.SECONDS), "first HTTP attempt should start");
            workerThread.interrupt();
            workerThread.join(5000);
            assertFalse(workerThread.isAlive(), "interrupted tick should return promptly");
            assertTrue(interruptObserved.get(), "worker should restore the interrupt flag after persisting retry state");
            assertEquals(1, db.queryForObject("select attempts from outbox where task_id=?", Integer.class, first.id()));
            assertEquals("READY", db.queryForObject("select state from outbox where task_id=?", String.class, first.id()));
            assertTrue(db.queryForObject("select lease_token is null and lease_until is null and next_attempt>now() from outbox where task_id=?", Boolean.class, first.id()));
            assertEquals(0, db.queryForObject("select attempts from outbox where task_id=?", Integer.class, second.id()), "the same tick must not claim the next task");
            assertEquals(1, db.queryForObject("select count(*) from exchange_events where task_id=? and event='ATTEMPT_1'", Integer.class, first.id()));
            assertEquals(1, db.queryForObject("select count(*) from exchange_events where task_id=? and event='AMBIGUOUS_RETRY'", Integer.class, first.id()));

            release.countDown();
            db.update("update outbox set next_attempt=now() where task_id=?", first.id());
            db.update("update outbox set next_attempt=now()+interval '1 hour' where task_id=?", second.id());
            assertTrue(worker.deliverOne(), "the interrupted attempt must remain retryable");
            assertEquals("DONE", db.queryForObject("select state from outbox where task_id=?", String.class, first.id()));
            assertEquals(2, db.queryForObject("select attempts from outbox where task_id=?", Integer.class, first.id()));
            assertEquals(0, db.queryForObject("select attempts from outbox where task_id=?", Integer.class, second.id()));
            assertEquals("SUCCEEDED", service.get("alice", first.id()).status());
        } finally {
            release.countDown();
            workerThread.interrupt();
            workerThread.join(1000);
            emulator.stop(0);
        }
    }

    @Test void migrationBackfillsLegacyV7AuditTransitionDetailsFromStoredHistory() throws Exception {
        String schema = "legacy_audit_" + UUID.randomUUID().toString().replace("-", "");
        UUID id = UUID.randomUUID();
        var legacy = org.flywaydb.core.Flyway.configure()
                .dataSource(dataSource)
                .schemas(schema)
                .defaultSchema(schema)
                .locations("classpath:db/migration")
                .target(org.flywaydb.core.api.MigrationVersion.fromVersion("7"))
                .load();
        try {
            legacy.migrate();
            var createdAt = java.sql.Timestamp.from(java.time.Instant.now().minusSeconds(20));
            db.update("insert into " + schema + ".tasks(id,owner_name,request_key,request_hash,title,status,result_version,created_at) values (?,?,?,?,?,'SUCCEEDED',1,?)",
                    id, "alice", "legacy-" + id, ExchangeService.hash("Legacy migration"), "Legacy migration", createdAt);
            db.update("insert into " + schema + ".outbox(task_id,state,attempts,next_attempt,attempt_limit,recovery_pending) values (?,'DONE',2,now(),5,false)", id);
            db.update("insert into " + schema + ".exchange_events(task_id,event,actor,created_at) values (?,?,?,?),(?,?,?,?),(?,?,?,?),(?,?,?,?),(?,?,?,?)",
                    id, "CREATED", "alice", createdAt,
                    id, "ATTEMPT_1", "worker", java.sql.Timestamp.from(createdAt.toInstant().plusSeconds(1)),
                    id, "AMBIGUOUS_RETRY", "worker", java.sql.Timestamp.from(createdAt.toInstant().plusSeconds(2)),
                    id, "ATTEMPT_2", "worker", java.sql.Timestamp.from(createdAt.toInstant().plusSeconds(3)),
                    id, "RESULT_APPLY", "executor", java.sql.Timestamp.from(createdAt.toInstant().plusSeconds(4)));
            db.update("insert into " + schema + ".reconciliations(id,task_id,actor,observed_at,local_status,local_version,delivery_state,attempts,external_state,external_status,external_version,external_executions,outcome) values (?,?,'operator',?,'SUCCEEDED',1,'DONE',2,'FOUND','SUCCEEDED',1,1,'MATCH')",
                    UUID.randomUUID(), id, java.sql.Timestamp.from(createdAt.toInstant().plusSeconds(5)));

            UUID exhaustedId = UUID.randomUUID();
            var exhaustedCreatedAt = java.sql.Timestamp.from(createdAt.toInstant().plusSeconds(30));
            db.update("insert into " + schema + ".tasks(id,owner_name,request_key,request_hash,title,status,result_version,created_at) values (?,?,?,?,?,'PENDING',0,?)",
                    exhaustedId, "alice", "legacy-exhausted-" + exhaustedId, ExchangeService.hash("Legacy exhausted"), "Legacy exhausted", exhaustedCreatedAt);
            db.update("insert into " + schema + ".outbox(task_id,state,attempts,next_attempt,attempt_limit,recovery_pending,failure_reason) values (?,'FAILED',5,now(),5,false,'TEMPORARY_DELIVERY_FAILURE')", exhaustedId);
            long secondOffset = 1;
            db.update("insert into " + schema + ".exchange_events(task_id,event,actor,created_at) values (?,?,?,?)",
                    exhaustedId, "CREATED", "alice", exhaustedCreatedAt);
            for (int attempt = 1; attempt <= 5; attempt++) {
                db.update("insert into " + schema + ".exchange_events(task_id,event,actor,created_at) values (?,?,?,?)",
                        exhaustedId, "ATTEMPT_" + attempt, "worker", java.sql.Timestamp.from(exhaustedCreatedAt.toInstant().plusSeconds(secondOffset++)));
                db.update("insert into " + schema + ".exchange_events(task_id,event,actor,created_at) values (?,?,?,?)",
                        exhaustedId, "AMBIGUOUS_RETRY", "worker", java.sql.Timestamp.from(exhaustedCreatedAt.toInstant().plusSeconds(secondOffset++)));
            }

            UUID conflictId = UUID.randomUUID();
            var conflictBase = java.sql.Timestamp.from(createdAt.toInstant().plusSeconds(60));
            var conflictAt = java.sql.Timestamp.from(conflictBase.toInstant().plusSeconds(2));
            db.update("insert into " + schema + ".tasks(id,owner_name,request_key,request_hash,title,status,result_version,created_at) values (?,?,?,?,?,'PENDING',0,?)",
                    conflictId, "alice", "legacy-conflict-" + conflictId, ExchangeService.hash("Legacy conflict"), "Legacy conflict", conflictBase);
            db.update("insert into " + schema + ".outbox(task_id,state,attempts,next_attempt,attempt_limit,failure_reason) values (?,'REVIEW',1,now(),5,'SAME_VERSION_DIFFERENT_RESULT')", conflictId);
            db.update("insert into " + schema + ".exchange_events(task_id,event,actor,created_at) values (?,?,?,?),(?,?,?,?),(?,?,?,?)",
                    conflictId, "CREATED", "alice", conflictBase,
                    conflictId, "ATTEMPT_1", "worker", java.sql.Timestamp.from(conflictBase.toInstant().plusSeconds(1)),
                    conflictId, "RESULT_CONFLICT", "executor", conflictAt);
            db.update("insert into " + schema + ".result_conflicts(task_id,attempt,current_version,incoming_version,current_status,incoming_status,reason,created_at) values (?,1,0,1,'PENDING','FAILED','SAME_VERSION_DIFFERENT_RESULT',?)",
                    conflictId, conflictAt);

            UUID reconciliationId = UUID.randomUUID();
            UUID reconciledTaskId = UUID.randomUUID();
            var reconciliationBase = java.sql.Timestamp.from(createdAt.toInstant().plusSeconds(120));
            var observedAt = java.sql.Timestamp.from(reconciliationBase.toInstant().plusSeconds(3));
            var decidedAt = java.sql.Timestamp.from(reconciliationBase.toInstant().plusSeconds(4));
            db.update("insert into " + schema + ".tasks(id,owner_name,request_key,request_hash,title,status,result_version,created_at) values (?,?,?,?,?,'SUCCEEDED',1,?)",
                    reconciledTaskId, "alice", "legacy-reconciled-" + reconciledTaskId, ExchangeService.hash("Legacy reconciled"), "Legacy reconciled", reconciliationBase);
            db.update("insert into " + schema + ".outbox(task_id,state,attempts,next_attempt,attempt_limit) values (?,'DONE',1,now(),5)", reconciledTaskId);
            db.update("insert into " + schema + ".exchange_events(task_id,event,actor,created_at) values (?,?,?,?),(?,?,?,?),(?,?,?,?),(?,?,?,?),(?,?,?,?)",
                    reconciledTaskId, "CREATED", "alice", reconciliationBase,
                    reconciledTaskId, "ATTEMPT_1", "worker", java.sql.Timestamp.from(reconciliationBase.toInstant().plusSeconds(1)),
                    reconciledTaskId, "AMBIGUOUS_RETRY", "worker", java.sql.Timestamp.from(reconciliationBase.toInstant().plusSeconds(2)),
                    reconciledTaskId, "RECONCILIATION_DIFFERENT", "operator", observedAt,
                    reconciledTaskId, "RECONCILIATION_DECISION_APPLY", "operator", decidedAt);
            db.update("insert into " + schema + ".reconciliations(id,task_id,actor,observed_at,local_status,local_version,delivery_state,attempts,external_state,external_status,external_version,external_executions,outcome,decision,decided_at,decided_by) values (?,?,?,?,'PENDING',0,'READY',1,'FOUND','SUCCEEDED',1,1,'DIFFERENT','APPLY',?,'operator')",
                    reconciliationId, reconciledTaskId, "operator", observedAt, decidedAt);

            UUID recoveryId = UUID.randomUUID();
            var recoveryBase = java.sql.Timestamp.from(createdAt.toInstant().plusSeconds(180));
            db.update("insert into " + schema + ".tasks(id,owner_name,request_key,request_hash,title,status,result_version,created_at) values (?,?,?,?,?,'PENDING',0,?)",
                    recoveryId, "alice", "legacy-recovery-" + recoveryId, ExchangeService.hash("Legacy recovery"), "Legacy recovery", recoveryBase);
            db.update("insert into " + schema + ".outbox(task_id,state,attempts,next_attempt,attempt_limit,recovery_pending) values (?,'READY',5,now(),10,true)", recoveryId);
            db.update("insert into " + schema + ".exchange_events(task_id,event,actor,created_at) values (?,?,?,?)", recoveryId, "CREATED", "alice", recoveryBase);
            long recoveryOffset = 1;
            for (int attempt = 1; attempt <= 5; attempt++) {
                db.update("insert into " + schema + ".exchange_events(task_id,event,actor,created_at) values (?,?,?,?)",
                        recoveryId, "ATTEMPT_" + attempt, "worker", java.sql.Timestamp.from(recoveryBase.toInstant().plusSeconds(recoveryOffset++)));
                db.update("insert into " + schema + ".exchange_events(task_id,event,actor,created_at) values (?,?,?,?)",
                        recoveryId, "AMBIGUOUS_RETRY", "worker", java.sql.Timestamp.from(recoveryBase.toInstant().plusSeconds(recoveryOffset++)));
            }
            var recoveryAt = java.sql.Timestamp.from(recoveryBase.toInstant().plusSeconds(recoveryOffset));
            db.update("insert into " + schema + ".recovery_commands(actor,command_key,task_id,created_at) values ('operator',?,?,?)", "legacy-recovery-key", recoveryId, recoveryAt);
            db.update("insert into " + schema + ".exchange_events(task_id,event,actor,created_at) values (?,'MANUAL_RECOVERY','operator',?)", recoveryId, recoveryAt);

            UUID unrecoverableId = UUID.randomUUID();
            var unrecoverableBase = java.sql.Timestamp.from(createdAt.toInstant().plusSeconds(240));
            db.update("insert into " + schema + ".tasks(id,owner_name,request_key,request_hash,title,status,result_version,created_at) values (?,?,?,?,?,'SUCCEEDED',1,?)",
                    unrecoverableId, "alice", "legacy-unrecoverable-" + unrecoverableId, ExchangeService.hash("Legacy payload unavailable"), "Legacy payload unavailable", unrecoverableBase);
            db.update("insert into " + schema + ".outbox(task_id,state,attempts,next_attempt,attempt_limit) values (?,'DONE',1,now(),5)", unrecoverableId);
            db.update("insert into " + schema + ".exchange_events(task_id,event,actor,created_at) values (?,?,?,?),(?,?,?,?),(?,?,?,?)",
                    unrecoverableId, "CREATED", "alice", unrecoverableBase,
                    unrecoverableId, "ATTEMPT_1", "worker", java.sql.Timestamp.from(unrecoverableBase.toInstant().plusSeconds(1)),
                    unrecoverableId, "RESULT_APPLY", "executor", java.sql.Timestamp.from(unrecoverableBase.toInstant().plusSeconds(2)));

            org.flywaydb.core.Flyway.configure()
                    .dataSource(dataSource)
                    .schemas(schema)
                    .defaultSchema(schema)
                    .locations("classpath:db/migration")
                    .load()
                    .migrate();

            var mapper = tools.jackson.databind.json.JsonMapper.builder().build();
            var events = db.queryForList("select event,details::text as details from " + schema + ".exchange_events where task_id=? order by id", id);
            assertEquals(5, events.size());
            var created = mapper.readValue((String) events.get(0).get("details"), java.util.Map.class);
            assertEquals("Legacy migration", created.get("title"));
            assertEquals("PENDING", created.get("newBusinessStatus"));
            assertEquals("READY", created.get("newDeliveryState"));
            var firstAttempt = mapper.readValue((String) events.get(1).get("details"), java.util.Map.class);
            assertEquals(0, ((Number) firstAttempt.get("attemptsBefore")).intValue());
            assertEquals(1, ((Number) firstAttempt.get("attemptsAfter")).intValue());
            var retry = mapper.readValue((String) events.get(2).get("details"), java.util.Map.class);
            assertEquals("READY", retry.get("oldDeliveryState"));
            assertEquals("READY", retry.get("newDeliveryState"));
            assertEquals("TEMPORARY_DELIVERY_FAILURE", retry.get("reason"));
            var secondAttempt = mapper.readValue((String) events.get(3).get("details"), java.util.Map.class);
            assertEquals(1, ((Number) secondAttempt.get("attemptsBefore")).intValue());
            assertEquals(2, ((Number) secondAttempt.get("attemptsAfter")).intValue());
            var applied = mapper.readValue((String) events.get(4).get("details"), java.util.Map.class);
            assertEquals("PENDING", applied.get("oldBusinessStatus"));
            assertEquals(0, ((Number) applied.get("oldResultVersion")).intValue());
            assertEquals("SUCCEEDED", applied.get("newBusinessStatus"));
            assertEquals(1, ((Number) applied.get("newResultVersion")).intValue());
            assertEquals("READY", applied.get("oldDeliveryState"));
            assertEquals("DONE", applied.get("newDeliveryState"));
            assertEquals(true, applied.get("incomingResultAvailable"));
            var appliedFromSnapshot = mapper.readValue((String) db.queryForObject("select details::text from " + schema + ".exchange_events where task_id=? and event='RESULT_APPLY'", String.class, id), java.util.Map.class);
            assertEquals("SUCCEEDED", appliedFromSnapshot.get("incomingBusinessStatus"));
            assertEquals(1, ((Number) appliedFromSnapshot.get("incomingResultVersion")).intValue());
            var lastRetry = db.queryForMap("select details::text as details from " + schema + ".exchange_events where task_id=? and event='AMBIGUOUS_RETRY' order by id desc limit 1", exhaustedId);
            var exhaustedDetails = mapper.readValue((String) lastRetry.get("details"), java.util.Map.class);
            assertEquals(5, ((Number) exhaustedDetails.get("attempts")).intValue());
            assertEquals("FAILED", exhaustedDetails.get("newDeliveryState"));
            assertEquals("TEMPORARY_DELIVERY_FAILURE", exhaustedDetails.get("reason"));

            var conflictDetailsRow = db.queryForMap("select details::text as details from " + schema + ".exchange_events where task_id=? and event='RESULT_CONFLICT'", conflictId);
            var conflictDetails = mapper.readValue((String) conflictDetailsRow.get("details"), java.util.Map.class);
            assertEquals("PENDING", conflictDetails.get("oldBusinessStatus"));
            assertEquals("FAILED", conflictDetails.get("incomingBusinessStatus"));
            assertEquals("SAME_VERSION_DIFFERENT_RESULT", conflictDetails.get("reason"));
            assertEquals("REVIEW", conflictDetails.get("newDeliveryState"));

            var reconciliationDetailsRow = db.queryForMap("select details::text as details from " + schema + ".exchange_events where task_id=? and event='RECONCILIATION_DECISION_APPLY'", reconciledTaskId);
            var reconciliationDetails = mapper.readValue((String) reconciliationDetailsRow.get("details"), java.util.Map.class);
            assertEquals("PENDING", reconciliationDetails.get("oldBusinessStatus"));
            assertEquals("SUCCEEDED", reconciliationDetails.get("newBusinessStatus"));
            assertEquals(1, ((Number) reconciliationDetails.get("newResultVersion")).intValue());
            assertEquals("DIFFERENT", reconciliationDetails.get("reconciliationOutcome"));
            assertEquals("SUCCEEDED", reconciliationDetails.get("externalBusinessStatus"));

            var recoveryDetailsRow = db.queryForMap("select details::text as details from " + schema + ".exchange_events where task_id=? and event='MANUAL_RECOVERY'", recoveryId);
            var recoveryDetails = mapper.readValue((String) recoveryDetailsRow.get("details"), java.util.Map.class);
            assertEquals(true, recoveryDetails.get("commandRecorded"));
            assertEquals("FAILED", recoveryDetails.get("oldDeliveryState"));
            assertEquals("READY", recoveryDetails.get("newDeliveryState"));
            assertEquals(10, ((Number) recoveryDetails.get("attemptLimitAfter")).intValue());

            var unavailableDetails = mapper.readValue((String) db.queryForObject("select details::text from " + schema + ".exchange_events where task_id=? and event='RESULT_APPLY'", String.class, unrecoverableId), java.util.Map.class);
            assertEquals(false, unavailableDetails.get("incomingResultAvailable"));
            assertEquals(false, unavailableDetails.get("legacyPayloadAvailable"));
            assertEquals(null, unavailableDetails.get("newBusinessStatus"));
            assertEquals("LEGACY_RESULT_PAYLOAD_NOT_RECORDED", unavailableDetails.get("reason"));

            assertEquals(0, db.queryForObject("select count(*) from " + schema + ".exchange_events where details='{}'::jsonb", Integer.class));
            assertThrows(org.springframework.dao.DataIntegrityViolationException.class,
                    () -> db.update("insert into " + schema + ".exchange_events(task_id,event,actor) values (?,?,?)", id, "EMPTY_AUDIT", "test"));
            assertThrows(org.springframework.dao.DataIntegrityViolationException.class,
                    () -> db.update("insert into " + schema + ".exchange_events(task_id,event,actor,details) values (?,?,?, '{}'::jsonb)", id, "EMPTY_AUDIT", "test"));
        } finally {
            db.execute("drop schema if exists " + schema + " cascade");
        }
    }
}
