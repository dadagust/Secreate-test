alter table outbox add column failure_reason text;
create table result_conflicts (
 id bigint generated always as identity primary key,
 task_id uuid not null references tasks(id), attempt integer not null,
 current_version bigint not null, incoming_version bigint not null,
 current_status varchar(20) not null, incoming_status varchar(20) not null,
 reason text not null, created_at timestamptz not null default now()
);
