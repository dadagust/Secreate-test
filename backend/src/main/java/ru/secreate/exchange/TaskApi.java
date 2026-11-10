package ru.secreate.exchange;

import org.springframework.web.bind.annotation.*;
import java.security.Principal;
import java.util.UUID;

@RestController
@RequestMapping("/api/tasks")
class TaskApi {
    private final ExchangeService service;
    private final RegistryService registry;
    TaskApi(ExchangeService service, RegistryService registry) { this.service=service; this.registry=registry; }
    @GetMapping java.util.Map<String,Object> list(org.springframework.security.core.Authentication user, @RequestParam(required=false) String status, @RequestParam(defaultValue="0") int page) {
        boolean operator=user.getAuthorities().stream().anyMatch(a -> a.getAuthority().equals("ROLE_OPERATOR"));
        return registry.list(user.getName(),operator,status,page,false);
    }
    record Assignment(String assignee, Long version) {}
    @PatchMapping("/{id}/assignee") java.util.Map<String,Object> assign(Principal user,@PathVariable UUID id,@RequestBody Assignment request) {
        return registry.assign(user.getName(),id,request.assignee(),request.version());
    }
    record Create(String title) {}
    @PostMapping ExchangeService.Task create(Principal user, @RequestHeader("Idempotency-Key") String key, @RequestBody Create request) {
        return service.create(user.getName(),key,request.title());
    }
    @GetMapping("/{id}") ExchangeService.Task get(Principal user,@PathVariable UUID id) { return service.get(user.getName(),id); }
}
