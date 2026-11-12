alter table exchange_events
  add column details jsonb not null default '{}'::jsonb,
  add constraint exchange_events_details_object check (jsonb_typeof(details) = 'object');
