'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const migration = fs.readFileSync(path.join(__dirname, '../supabase/migrations/20261117_quantity_habits.sql'), 'utf8');
const schema = fs.readFileSync(path.join(__dirname, '../supabase/schema.sql'), 'utf8');

test('quantity migration is repeatable and leaves existing habits as checkbox habits', () => {
  for (const column of ['tracking_type', 'unit', 'daily_target', 'client_schema']) {
    assert.match(migration, new RegExp(`add column if not exists ${column}`));
  }
  assert.match(migration, /tracking_type text not null default 'checkbox'/);
  assert.match(migration, /old\.tracking_type = 'quantity' and new\.client_schema < 2/);
  assert.match(migration, /entry\.value \? 'value'/);
  assert.doesNotMatch(migration, /\b(drop table|truncate)\b/i);
});

test('fresh schema keeps RLS and supports the same measurement upgrade', () => {
  assert.match(schema, /alter table public\.habits enable row level security/i);
  assert.match(schema, /tracking_type text not null default 'checkbox'/);
  assert.match(schema, /client_schema integer not null default 1/);
  assert.match(schema, /create trigger habits_preserve_quantity_data/i);
});

