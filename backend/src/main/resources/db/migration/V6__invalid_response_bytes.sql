alter table reconciliations add column invalid_response_bytes bytea;
-- Previously saved text is valid PostgreSQL text and can be encoded as UTF-8.
update reconciliations set invalid_response_bytes=convert_to(invalid_response,'UTF8')
where invalid_response is not null;
