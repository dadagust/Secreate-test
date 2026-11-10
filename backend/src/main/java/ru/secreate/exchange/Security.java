package ru.secreate.exchange;

import org.springframework.context.annotation.*;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.core.userdetails.*;
import org.springframework.security.provisioning.InMemoryUserDetailsManager;
import org.springframework.security.config.http.SessionCreationPolicy;

@Configuration
class Security {
    @Bean UserDetailsService users() {
        return new InMemoryUserDetailsManager(
                User.withUsername("alice").password("{noop}demo-alice").roles("INITIATOR").build(),
                User.withUsername("bob").password("{noop}demo-bob").roles("INITIATOR").build(),
                User.withUsername("operator").password("{noop}demo-operator").roles("OPERATOR").build());
    }
    @Bean SecurityFilterChain filter(HttpSecurity http) throws Exception {
        return http.csrf(c -> c.disable()).sessionManagement(s -> s.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
                .authorizeHttpRequests(a -> a.requestMatchers("/api/operator/**").hasRole("OPERATOR").requestMatchers(org.springframework.http.HttpMethod.PATCH,"/api/tasks/*/assignee").hasRole("OPERATOR").requestMatchers(org.springframework.http.HttpMethod.POST,"/api/tasks").hasRole("INITIATOR").anyRequest().authenticated()).httpBasic(b -> {}).build();
    }
}
