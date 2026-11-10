package ru.secreate.exchange;

import java.util.Map;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.server.ResponseStatusException;

@RestControllerAdvice
class ApiErrors {
    @ExceptionHandler(ResponseStatusException.class)
    ResponseEntity<Map<String,String>> status(ResponseStatusException exception) {
        String reason=exception.getReason();
        return ResponseEntity.status(exception.getStatusCode()).body(Map.of("message",reason==null?"Запрос не выполнен":reason));
    }
}
