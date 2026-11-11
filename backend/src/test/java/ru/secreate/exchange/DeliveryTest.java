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
}
