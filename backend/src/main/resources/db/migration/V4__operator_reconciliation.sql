alter table outbox add column attempt_limit integer not null default 5;
create table reconciliations (
 id uuid primary key, task_id uuid not null references tasks(id), actor varchar(100) not null,
 observed_at timestamptz not null default now(), local_status varchar(20) not null,
 local_version bigint not null, delivery_state varchar(20) not null, attempts integer not null,
 external_state varchar(20) not null, external_status varchar(20), external_version bigint,
 external_executions integer, outcome varchar(20) not null, decision varchar(20), decided_at timestamptz, decided_by varchar(100)
);
create table recovery_commands (
 actor varchar(100) not null, command_key varchar(200) not null,
 task_id uuid not null references tasks(id), created_at timestamptz not null default now(),
 primary key(actor,command_key)
);
