create table operator_scope (
    operator_name varchar(100) not null,
    owner_name varchar(100) not null,
    primary key (operator_name, owner_name)
);
insert into operator_scope(operator_name, owner_name) values ('operator', 'alice');
