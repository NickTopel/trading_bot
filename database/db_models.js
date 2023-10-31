const lib = require('../lib/index.js');
const knex = lib.config.db;

//===== MODELS =====
Promise.resolve()
//TODO: settings
//TODO: allocation

//CHECK: performance
.then(() => {
  return knex.schema.createTable('performance', (table) => {
    table.string('performance_id', 50).notNullable().primary().unique();
    table.string('strategy_id', 50).notNullable().references('strategies.strategy_id').onDelete('CASCADE').index();
    table.decimal('strategy_value', 30, 15).notNullable();
    table.jsonb('industries').notNullable().defaultTo('{}');
    table.decimal('gain_hour', 30, 15).notNullable().defaultTo(0);
    table.decimal('gain_day', 30, 15).notNullable().defaultTo(0);
    table.decimal('gain_week', 30, 15).notNullable().defaultTo(0);
    table.decimal('gain_month', 30, 15).notNullable().defaultTo(0);
    table.decimal('gain_year', 30, 15).notNullable().defaultTo(0);
    table.decimal('gain_five_year', 30, 15).notNullable().defaultTo(0);
    table.timestamp('created_at').notNullable().defaultTo(knex.raw('now()')).index();
  });
})

//TODO: timelines

//DONE: errors
.then(() => {
  return knex.schema.createTable('errors', (table) => {
    table.string('error_id', 50).notNullable().primary().unique();
    table.string('type', 50).notNullable().index();
    table.jsonb('info').notNullable().defaultTo('{}');
    table.string('message', 30000);
    table.timestamp('created_at').notNullable().defaultTo(knex.raw('now()')).index();
  });
})

// FINISH
.then((data) => {
  console.log('Done!!');
})
// EXIT
.then(() => {
  process.exit(0);
});

