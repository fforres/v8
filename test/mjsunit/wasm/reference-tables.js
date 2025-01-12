// Copyright 2020 the V8 project authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

// Flags: --experimental-wasm-gc

d8.file.execute('test/mjsunit/wasm/wasm-module-builder.js');
(function TestTables() {
  print(arguments.callee.name);
  var exporting_instance = (function() {
    var builder = new WasmModuleBuilder();
    var binary_type = builder.addType(kSig_i_ii);

    builder.addFunction('addition', kSig_i_ii)
        .addBody([kExprLocalGet, 0, kExprLocalGet, 1, kExprI32Add])
        .exportFunc();

    builder.addFunction('succ', kSig_i_i)
        .addBody([kExprLocalGet, 0, kExprI32Const, 1, kExprI32Add])
        .exportFunc();

    builder.addTable(wasmRefNullType(binary_type), 1, 100).exportAs('table');

    return builder.instantiate({});
  })();

  // Wrong type for imported table.
  assertThrows(() => {
    var builder = new WasmModuleBuilder();
    var unary_type = builder.addType(kSig_i_i);
    builder.addImportedTable(
        'imports', 'table', 1, 100, wasmRefNullType(unary_type));
    builder.instantiate({imports: {table: exporting_instance.exports.table}})
  }, WebAssembly.LinkError, /imported table does not match the expected type/)

  // Type for imported table must match exactly.
  assertThrows(() => {
    var builder = new WasmModuleBuilder();
    builder.addImportedTable('imports', 'table', 1, 100, kWasmFuncRef);
    builder.instantiate({imports: {table: exporting_instance.exports.table}})
  }, WebAssembly.LinkError, /imported table does not match the expected type/)

  var instance = (function() {
    var builder = new WasmModuleBuilder();

    var unary_type = builder.addType(kSig_i_i);
    var binary_type = builder.addType(kSig_i_ii);

    builder.addImportedTable(
        'imports', 'table', 1, 100, wasmRefNullType(binary_type));

    var table =
        builder.addTable(wasmRefNullType(unary_type), 10).exportAs('table');
    builder.addTable(kWasmFuncRef, 1).exportAs('generic_table');

    builder
        .addFunction(
            'table_test', makeSig([wasmRefType(unary_type)], [kWasmI32]))
        // Set table[0] to input function, then retrieve it and call it.
        .addBody([
          kExprI32Const, 0, kExprLocalGet, 0, kExprTableSet, table.index,
          kExprI32Const, 42, kExprI32Const, 0, kExprTableGet, table.index,
          kExprCallRef
        ])
        .exportFunc();

    // Same, but with table[1] and call_indirect
    builder
        .addFunction(
            'table_indirect_test',
            makeSig([wasmRefType(unary_type)], [kWasmI32]))
        .addBody([
          kExprI32Const, 1, kExprLocalGet, 0, kExprTableSet, table.index,
          kExprI32Const, 42, kExprI32Const, 0, kExprCallIndirect, unary_type,
          table.index
        ])
        .exportFunc();

    // Instantiate with a table of the correct type.
    return builder.instantiate(
        {imports: {table: exporting_instance.exports.table}});
  })();

  // This module is valid.
  assertTrue(!!instance);

  // The correct function reference is preserved when setting it to and getting
  // it back from a table.
  assertEquals(
      43, instance.exports.table_test(exporting_instance.exports.succ));
  // Same for call indirect (the indirect call tables are also set correctly).
  assertEquals(
      43,
      instance.exports.table_indirect_test(exporting_instance.exports.succ));

  // Setting from JS API respects types.
  instance.exports.generic_table.set(0, exporting_instance.exports.succ);
  instance.exports.table.set(0, exporting_instance.exports.succ);
  assertThrows(
      () => instance.exports.table.set(0, exporting_instance.exports.addition),
      TypeError,
      /Argument 1 is invalid for table of type \(ref null 0\)/);
})();

(function TestNonNullableTables() {
  print(arguments.callee.name);
  var builder = new WasmModuleBuilder();

  var binary_type = builder.addType(kSig_i_ii);

  var addition = builder.addFunction('addition', binary_type).addBody([
    kExprLocalGet, 0, kExprLocalGet, 1, kExprI32Add
  ]);
  var subtraction =
      builder.addFunction('subtraction', binary_type)
          .addBody([kExprLocalGet, 0, kExprLocalGet, 1, kExprI32Sub])
          .exportFunc();

  var table = builder.addTable(wasmRefType(binary_type), 3, 3,
                               [kExprRefFunc, addition.index]);

  builder.addFunction('init', kSig_v_v)
      .addBody([
        kExprI32Const, 1, kExprRefFunc, subtraction.index, kExprTableSet,
        table.index
      ])
      .exportFunc();

  // (index, arg1, arg2) -> table[index](arg1, arg2)
  builder.addFunction('table_test', kSig_i_iii)
      .addBody([
        kExprLocalGet, 1, kExprLocalGet, 2, kExprLocalGet, 0, kExprCallIndirect,
        binary_type, table.index
      ])
      .exportFunc();

  var instance = builder.instantiate({});

  assertTrue(!!instance);

  instance.exports.init();
  assertEquals(44, instance.exports.table_test(0, 33, 11));
  assertEquals(22, instance.exports.table_test(1, 33, 11));
})();

(function TestAnyRefTable() {
  print(arguments.callee.name);
  let builder = new WasmModuleBuilder();

  let array_type = builder.addArray(kWasmI32);
  let struct_type = builder.addStruct([makeField(kWasmI32, false)]);

  let table = builder.addTable(kWasmAnyRef, 4, 4);
  builder.addActiveElementSegment(
    table, wasmI32Const(0),
    [[...wasmI32Const(111), ...wasmI32Const(222),
      kGCPrefix, kExprArrayNewFixedStatic, array_type, 2],
     [...wasmI32Const(-31), kGCPrefix, kExprI31New],
     [...wasmI32Const(10), kGCPrefix, kExprStructNew, struct_type],
     [kExprRefNull, kEqRefCode]],
    kWasmAnyRef);

  // return ...static_cast<array_type>(table[0])(local_0)
  builder.addFunction("array_getter", kSig_ii_i)
    .addLocals(wasmRefNullType(array_type), 1)
    .addBody([
      kExprI32Const, 0, kExprTableGet, 0,
      kGCPrefix, kExprRefAsArray,
      kGCPrefix, kExprRefCastStatic, array_type,
      kExprLocalSet, 1,
      kExprLocalGet, 1,
      ...wasmI32Const(0), kGCPrefix, kExprArrayGet, array_type,
      kExprLocalGet, 1,
      ...wasmI32Const(1), kGCPrefix, kExprArrayGet, array_type])
    .exportFunc();

  // return static_cast<i31>(table[1])(local_0, local_1)
  builder.addFunction("i31_getter", kSig_i_v)
   .addBody([
     kExprI32Const, 1, kExprTableGet, 0,
     kGCPrefix, kExprRefAsI31,
     kGCPrefix, kExprI31GetS])
   .exportFunc();

  // return static_cast<struct_type>(table[2]).field_0
  builder.addFunction("struct_getter", kSig_i_v)
    .addBody([
      kExprI32Const, 2, kExprTableGet, 0,
      kGCPrefix, kExprRefAsData, kGCPrefix, kExprRefCastStatic, struct_type,
      kGCPrefix, kExprStructGet, struct_type, 0])
    .exportFunc();

  // return table[3] == null
  builder.addFunction("null_getter", kSig_i_v)
    .addBody([kExprI32Const, 3, kExprTableGet, 0, kExprRefIsNull])
    .exportFunc();

  let instance = builder.instantiate({});

  assertTrue(!!instance);

  assertEquals([111, 222], instance.exports.array_getter(42));
  assertEquals(-31, instance.exports.i31_getter(12, 19));
  assertEquals(10, instance.exports.struct_getter());
  assertEquals(1, instance.exports.null_getter());
})();
