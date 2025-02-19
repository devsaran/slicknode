/**
 * Created by Ivo Meißner on 02.12.16.
 *
 */

import {
  assertObjectTypeConfig,
  FieldConfig,
  isContent,
  ObjectTypeConfig,
  TypeKind,
  TypeConfig,
} from '../../../../definition';

import {
  HANDLER_POSTGRES,
  HandlerError,
  MigrationScope,
} from '../../base';

import { DEFAULT_PRIMARY_KEY } from '../constants';

import toColumnName from '../toColumnName';
import toTableName, { TableType } from '../toTableName';
import toIndexName from '../toIndexName';
import toForeignKeyName from '../toForeignKeyName';
import toUniqueConstraintName from '../toUniqueConstraintName';
import applyQueryFilter from '../applyQueryFilter';
import applyPermissionQueryFilter from '../applyPermissionQueryFilter';

import Knex$Knex, { ColumnBuilder, QueryBuilder } from 'knex';

import { ID } from './index';

import Context from '../../../../context';

import AbstractFieldHandler from './AbstractFieldHandler';
import { FieldStorageType } from '../../../../definition/FieldStorageType';
import { getPgTypeName } from './IDHandler';

/* eslint-disable no-unused-vars */
export default class RelatedObjectHandler extends AbstractFieldHandler {
  /**
   * Creates the DB columns on the given table for the field
   * Returns an optional Promise that executes deferred operations in the database after
   * all createField operations are executed during a migration.
   * This can be used to create foreignKey constraints.
   */
  createField(
    table: any,
    fieldName: string,
    fieldConfig: FieldConfig,
    scope: MigrationScope
  ): void {
    if (fieldConfig.list) {
      throw new HandlerError('List is not supported for fields of type String');
    }

    const fieldType = assertObjectTypeConfig(
      scope.newTypes[fieldConfig.typeName]
    );
    const referencedIdField: FieldConfig =
      fieldType.fields[DEFAULT_PRIMARY_KEY];

    // Create column
    let column: ColumnBuilder;
    if (referencedIdField.storageType === FieldStorageType.UUID) {
      column = table.uuid(toColumnName(fieldName));
    } else {
      column = table.bigInteger(toColumnName(fieldName)).unsigned();
    }

    // Related objects always get an index if they don't already have one through unique constraint
    if (!fieldConfig.unique) {
      column = column.index(toIndexName(table._tableName, [fieldName]));
    }

    if (fieldConfig.required) {
      column = column.notNullable();
    }
  }

  /**
   * Creates the field dependencies like ForeignKeyConstraints
   * This function is executed after the field was created and after all other types
   * are created within the migration
   */
  createFieldDependencies(
    db: Knex$Knex,
    typeConfig: ObjectTypeConfig,
    fieldName: string,
    fieldConfig: FieldConfig,
    scope: MigrationScope,
    tableName: string
  ) {
    if (fieldConfig.list) {
      throw new HandlerError(
        'List is not supported for fields of type RelatedObject'
      );
    }

    // Check if references type has compatible handler
    const fieldType: TypeConfig = scope.newTypes[fieldConfig.typeName];
    if (
      !fieldType ||
      fieldType.kind !== TypeKind.OBJECT ||
      !fieldType.handler ||
      fieldType.handler.kind !== HANDLER_POSTGRES
    ) {
      throw new Error('Related types have to have the postgres handler');
    }

    const columnName = toColumnName(fieldName);

    // Create table for type
    const queryBuilder = db.schema.alterTable(tableName, (table) => {
      const reference = table
        .foreign(columnName, toForeignKeyName(tableName, fieldName))
        .references('id')
        .inTable(toTableName(fieldType, scope.config.schemaName));

      // Set behavior on cascade
      if (fieldConfig.required) {
        reference.onDelete('CASCADE');
      } else {
        reference.onDelete('SET NULL');
      }
    });

    if (fieldConfig.unique) {
      // For content types, we need to add the locale field, so we can have
      // the same value for multiple locales
      const columns = [columnName];
      if (isContent(typeConfig) && fieldName !== 'locale') {
        columns.push(toColumnName('locale'));
      }

      queryBuilder.raw(
        db
          .raw(
            `create unique index ?? on ?? (${columns
              .map(() => '??')
              .join(', ')}) where ?? is not null`,
            [
              toUniqueConstraintName(tableName, [columnName]),
              tableName,
              ...columns,
              columnName,
            ]
          )
          .toString()
      );
    }

    return queryBuilder;
  }

  /**
   * Updates the field dependencies like ForeignKeyConstraints
   * This function is executed after the field was updated and after all other types
   * are created within the migration
   */
  updateFieldDependencies(
    db: Knex$Knex,
    typeConfig: ObjectTypeConfig,
    fieldName: string,
    fieldConfig: FieldConfig,
    previousConfig: FieldConfig,
    scope: MigrationScope,
    tableName: string
  ) {
    if (fieldConfig.list) {
      throw new HandlerError(
        'List is not supported for fields of type RelatedObject'
      );
    }

    // Check if references type has compatible handler
    const fieldType: TypeConfig = scope.newTypes[fieldConfig.typeName];
    if (
      !fieldType ||
      fieldType.kind !== TypeKind.OBJECT ||
      !fieldType.handler ||
      fieldType.handler.kind !== HANDLER_POSTGRES
    ) {
      throw new Error('Related types have to have the postgres handler');
    }

    const columnName = toColumnName(fieldName);

    // Create table for type
    const queryBuilder = db.schema.alterTable(tableName, (table) => {
      // Update cascade behavior if required attribute changed
      if (fieldConfig.required !== previousConfig.required) {
        // Foreign key constraints can't be altered in postgres, have to be recreated
        table.dropForeign([columnName], toForeignKeyName(tableName, fieldName));

        const reference = table
          .foreign(columnName, toForeignKeyName(tableName, fieldName))
          .references('id')
          .inTable(toTableName(fieldType, scope.config.schemaName));

        // Set behavior on cascade
        if (fieldConfig.required) {
          reference.onDelete('CASCADE');
        } else {
          reference.onDelete('SET NULL');
        }
      }
    });

    // Create unique index if setting changed
    if (fieldConfig.unique && !previousConfig.unique) {
      // For content types, we need to add the locale field, so we can have
      // the same value for multiple locales
      const columns = [columnName];
      if (isContent(typeConfig) && fieldName !== 'locale') {
        columns.push(toColumnName('locale'));
      }

      queryBuilder.raw(
        db
          .raw(
            `create unique index ?? on ?? (${columns
              .map(() => '??')
              .join(', ')}) where ?? is not null`,
            [
              toUniqueConstraintName(tableName, [columnName]),
              tableName,
              ...columns,
              columnName,
            ]
          )
          .toString()
      );
    }

    return queryBuilder;
  }

  /**
   * Deletes the DB columns for the table
   */
  deleteField(table: any, fieldName: string, fieldConfig: FieldConfig): void {
    table.dropColumn(toColumnName(fieldName));
  }

  /**
   * Updates the field in the existing table
   */
  updateField(
    table: any,
    fieldName: string,
    fieldConfig: FieldConfig,
    previousConfig: FieldConfig,
    scope: MigrationScope
  ): void {
    // Create column
    const fieldType = assertObjectTypeConfig(
      scope.newTypes[fieldConfig.typeName]
    );
    const referencedIdField: FieldConfig =
      fieldType.fields[DEFAULT_PRIMARY_KEY];

    let column: ColumnBuilder;
    if (referencedIdField.storageType === FieldStorageType.UUID) {
      column = table.uuid(toColumnName(fieldName));
    } else {
      column = table.bigInteger(toColumnName(fieldName)).unsigned();
    }

    if (fieldConfig.required) {
      column = column.notNullable();
    } else {
      column = column.nullable();
    }

    // Add normal index if unique index was removed
    if (!fieldConfig.unique && previousConfig.unique) {
      column = column.index(toIndexName(table._tableName, [fieldName]));
      table.dropIndex(
        null,
        // If we have schema name, add prefix
        (scope.config.schemaName ? scope.config.schemaName + '.' : '') +
          toUniqueConstraintName(table._tableName, [fieldName])
      );
    }

    // Drop normal index and replace with unique index
    if (fieldConfig.unique && !previousConfig.unique) {
      table.dropIndex(
        null,
        // If we have schema name, add prefix
        (scope.config.schemaName ? scope.config.schemaName + '.' : '') +
          toIndexName(table._tableName, [fieldName])
      );
    }

    column.alter();
  }

  /**
   * Applies the filter to the given query builder
   * @param queryBuilder The Knex query builder
   * @param fieldName The field name
   * @param fieldConfig The field config
   * @param tableName The table name
   * @param filterValue The filter value that was provided via GraphQL args
   * @param getTableAlias Returns a free table alias that can be used for joins
   * @param context
   * @param noPermissionFilters
   * @param preview
   * @return Returns the query builder with filter arguments applied
   */
  applyQueryFilter(
    queryBuilder: QueryBuilder,
    fieldName: string,
    fieldConfig: FieldConfig,
    tableName: string,
    filterValue: any,
    getTableAlias: () => string,
    context: Context,
    noPermissionFilters: boolean,
    preview: boolean
  ): QueryBuilder {
    // Check if we can do the filtering inline in object of if we need a join
    const keys = Object.keys(filterValue);
    if (keys.length === 1 && keys[0] === DEFAULT_PRIMARY_KEY) {
      // We can do filtering on actual node
      return ID.applyQueryFilter(
        queryBuilder,
        fieldName,
        fieldConfig,
        tableName,
        filterValue[keys[0]],
        getTableAlias,
        context,
        preview
      );
    } else if (keys.length > 0) {
      // Get object type config
      const typeConfig: ObjectTypeConfig = context.schemaBuilder.getObjectTypeConfig(
        fieldConfig.typeName
      );
      if (!typeConfig.handler || typeConfig.handler.kind !== HANDLER_POSTGRES) {
        throw new Error('Related query filtering only allowed on RDBMS types');
      }

      // We need to join related node
      queryBuilder.whereExists(function () {
        const filterTable = getTableAlias();
        this.select(1)
          .from(
            `${toTableName(
              typeConfig,
              context.getDBSchemaName(),
              preview ? TableType.PREVIEW : TableType.DEFAULT
            )} AS ${filterTable}`
          )
          .whereRaw('?? = ??', [
            tableName + '.' + toColumnName(fieldName),
            filterTable + '.' + DEFAULT_PRIMARY_KEY,
          ]);

        // Add permission filters
        if (!noPermissionFilters) {
          applyPermissionQueryFilter({
            query: this,
            typeConfig,
            permissions: typeConfig.permissions,
            tableName: filterTable,
            getTableAlias,
            context,
            preview,
          });
        }

        return applyQueryFilter({
          query: this,
          filter: filterValue,
          typeConfig,
          tableName: filterTable,
          getTableAlias,
          context,
          noPermissionFilters,
          preview,
        });
      });
    }

    return queryBuilder;
  }

  /**
   * Returns an object of all values that should be saved to the DB instance
   * These values will be passed to knex.insert(*)
   * Only returns the values that are relevant to the field, other values of input
   * are ignored
   */
  prepareValues(
    input: {
      [x: string]: any;
    },
    fieldName: string,
    fieldConfig: FieldConfig,
    addDefault: boolean,
    db: Knex$Knex,
    context: Context
  ): {
    [x: string]: any;
  } {
    let value = input[fieldName];

    // Add explicit type casting so bigint / uuid field works with RDS Data API driver
    // See: https://forums.aws.amazon.com/thread.jspa?threadID=312154&tstart=0
    //
    // Only add type casting for non NULL values
    let preparedValue = value;
    if (value !== null && value !== undefined) {
      // Get referenced PK field to determine type
      const typeConfig = context.schemaBuilder.getObjectTypeConfig(
        fieldConfig.typeName
      );
      const referencedFieldConfig = typeConfig.fields[DEFAULT_PRIMARY_KEY];
      const pgTypeName = getPgTypeName(referencedFieldConfig);

      // Get referenced ID field config
      preparedValue = db.raw(`?::${pgTypeName}`, [value]);
    }

    return {
      [toColumnName(fieldName)]: preparedValue,
    };
  }

  /**
   * Prepares the default value to be inserted into the DB
   * The FieldConfig.defaultValue is passed as an argument and the function
   * returns a value that is then passed to knex.insert({fieldName: value})
   */
  prepareDefaultValue(defaultValue: any, knex: Knex$Knex): any {
    return defaultValue;
  }

  /**
   * Extracts the data from the RDBMS result object. The return value will then
   * be passed to the resolver
   *
   * @param result
   * @param fieldName
   * @param fieldConfig
   */
  extractValue(
    result: {
      [x: string]: any;
    },
    fieldName: string,
    fieldConfig: FieldConfig
  ): any {
    return result[toColumnName(fieldName)];
  }

  /**
   * Returns an array of all column names for the field where the data is stored
   * @param fieldName
   * @param fieldConfig
   */
  getColumnNames(fieldName: string, fieldConfig: FieldConfig): Array<string> {
    return [toColumnName(fieldName)];
  }
}
