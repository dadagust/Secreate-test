create table tasks (
 id uuid primary key, owner_name varchar(100) not null, request_key varchar(200) not null,
 request_hash varchar(64) not null, title varchar(200) not null,
 status varchar(20) not null default 'PENDING', result_version bigint not null default 0,
 created_at timestamptz not null default now(), unique(owner_name, request_key)
);
create table outbox (
 task_id uuid primary key references tasks(id), state varchar(20) not null default 'READY',
 attempts integer not null default 0, next_attempt timestamptz not null default now(),
 lease_until timestamptz, lease_token uuid
);
create index outbox_due on outbox(state, next_attempt);
create table exchange_events (
 id bigint generated always as identity primary key, task_id uuid not null references tasks(id),
 event varchar(100) not null, actor varchar(100) not null, created_at timestamptz not null default now()
);
