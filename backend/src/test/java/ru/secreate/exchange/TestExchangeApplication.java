package ru.secreate.exchange;

import org.springframework.boot.SpringApplication;

public class TestExchangeApplication {

	public static void main(String[] args) {
		SpringApplication.from(ExchangeApplication::main).with(TestcontainersConfiguration.class).run(args);
	}

}
