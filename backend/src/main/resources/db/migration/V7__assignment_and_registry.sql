alter table tasks add column assignee varchar(100);
alter table tasks add column local_version bigint not null default 0;
create table assignment_audit (
 id bigint generated always as identity primary key,
 task_id uuid not null references tasks(id), actor varchar(100) not null,
 old_assignee varchar(100), new_assignee varchar(100) not null,
 old_version bigint not null, new_version bigint not null,
 created_at timestamptz not null default now()
);
create index tasks_registry on tasks(owner_name,status,created_at desc,id desc);
