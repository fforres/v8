// Copyright 2022 the V8 project authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

// Flags: --experimental-wasm-gc

d8.file.execute('test/mjsunit/wasm/wasm-module-builder.js');

let tableTypes = {
  "anyref": kWasmAnyRef,
  "eqref": kWasmEqRef,
  "dataref": kWasmDataRef,
  "arrayref": kWasmArrayRef,
};

// Test table consistency check.
for (let [typeName, type] of Object.entries(tableTypes)) {
  print("TestTableTypeCheck_" + typeName);
  let builder = new WasmModuleBuilder();
  const size = 10;
  builder.addImportedTable("imports", "table", size, size, type);

  for (let typeName2 in tableTypes) {
    let table = new WebAssembly.Table({
      initial: size, maximum: size, element: typeName2
    });
    if (typeName == typeName2) {
      builder.instantiate({ imports: { table } });
    } else {
      let err = 'WebAssembly.Instance(): Import #0 module="imports" ' +
                'function="table" error: imported table does not match the ' +
                'expected type';
      assertThrows(() => builder.instantiate({ imports: { table } }),
                   WebAssembly.LinkError,
                   err);
    }
  }
}

// Test table usage from JS and Wasm.
for (let [typeName, type] of Object.entries(tableTypes)) {
  print("TestImportedTable_" + typeName);
  let builder = new WasmModuleBuilder();

  const size = 10;
  let table = new WebAssembly.Table({
    initial: size, maximum: size, element: typeName
  });

  let creatorSig = builder.addType(makeSig([], [type]));
  let struct = builder.addStruct([makeField(kWasmI32, false)]);
  let array = builder.addArray(kWasmI32, true);

  builder.addImportedTable("imports", "table", size, size, type);
  builder.addFunction("tableSet",
                      makeSig([kWasmI32, wasmRefType(creatorSig)], []))
    .addBody([
      kExprLocalGet, 0,
      kExprLocalGet, 1,
      kExprCallRef,
      kExprTableSet, 0,
    ])
    .exportFunc();
  builder.addFunction("tableGet", makeSig([kWasmI32], [kWasmExternRef]))
    .addBody([
      kExprLocalGet, 0, kExprTableGet, 0,
      kGCPrefix, kExprExternExternalize,
    ])
    .exportFunc();

  let getValSig = makeSig([kWasmI32], [kWasmI32]);
  builder.addFunction("tableGetStructVal", getValSig)
    .addBody([
      kExprLocalGet, 0, kExprTableGet, 0,
      kGCPrefix, kExprRefAsData,
      kGCPrefix, kExprRefCastStatic, struct,
      kGCPrefix, kExprStructGet, struct, 0,
    ])
    .exportFunc();
  builder.addFunction("tableGetArrayVal", getValSig)
    .addBody([
      kExprLocalGet, 0, kExprTableGet, 0,
      kGCPrefix, kExprRefAsData,
      kGCPrefix, kExprRefCastStatic, array,
      kExprI32Const, 0,
      kGCPrefix, kExprArrayGet, array,
    ])
    .exportFunc();

  builder.addFunction("exported",
                      makeSig([wasmRefType(creatorSig)], [kWasmExternRef]))
    .addBody([
      kExprLocalGet, 0,
      kExprCallRef,
      kGCPrefix, kExprExternExternalize,
    ])
    .exportFunc();

  let blockSig = builder.addType(makeSig([kWasmAnyRef], [kWasmEqRef]));
  let castExternToEqRef = [
    kGCPrefix, kExprExternInternalize,
    kExprBlock, blockSig,
      kGCPrefix, kExprBrOnI31, 0,
      kGCPrefix, kExprBrOnData, 0,
      // non-data, non-i31
      kExprUnreachable, // conversion failure
    kExprEnd,
  ];
  // TODO(7748): Directly compare the externrefs in JS once
  // FLAG_wasm_gc_js_interop is supported.
  builder.addFunction("eq",
                      makeSig([kWasmExternRef, kWasmExternRef], [kWasmI32]))
    .addBody([
      kExprLocalGet, 0,
      ...castExternToEqRef,
      kExprLocalGet, 1,
      ...castExternToEqRef,
      kExprRefEq,
    ])
    .exportFunc();

  builder.addFunction("createNull", creatorSig)
    .addBody([kExprRefNull, kNullRefCode])
    .exportFunc();
  if (typeName != "dataref" && typeName != "arrayref") {
    builder.addFunction("createI31", creatorSig)
      .addBody([kExprI32Const, 12, kGCPrefix, kExprI31New])
      .exportFunc();
  }
  if (typeName != "arrayref") {
    builder.addFunction("createStruct", creatorSig)
      .addBody([kExprI32Const, 12, kGCPrefix, kExprStructNew, struct])
      .exportFunc();
  }
  builder.addFunction("createArray", creatorSig)
    .addBody([
      kExprI32Const, 12,
      kGCPrefix, kExprArrayNewFixedStatic, array, 1
    ])
    .exportFunc();

  let instance = builder.instantiate({ imports: { table } });
  let wasm = instance.exports;

  // Set null.
  table.set(0, null);
  assertEquals(null, wasm.tableGet(0));
  assertEquals(null, table.get(0));
  wasm.tableSet(1, wasm.createNull);
  assertEquals(null, wasm.tableGet(1));
  assertEquals(null, table.get(1));
  // Set i31.
  if (typeName != "dataref" && typeName != "arrayref") {
    table.set(2, wasm.exported(wasm.createI31));
    assertEquals(1, wasm.eq(table.get(2), wasm.tableGet(2)));
    wasm.tableSet(3, wasm.createI31);
    assertEquals(1, wasm.eq(table.get(3), wasm.tableGet(3)));
    assertEquals(1, wasm.eq(table.get(2), table.get(3))); // The same smi.
  }
  // Set struct.
  if (typeName != "arrayref") {
    table.set(4, wasm.exported(wasm.createStruct));
    assertEquals(1, wasm.eq(table.get(4), wasm.tableGet(4)));
    assertEquals(12, wasm.tableGetStructVal(4));
    wasm.tableSet(5, wasm.createStruct);
    assertEquals(1, wasm.eq(table.get(5), wasm.tableGet(5)));
    assertEquals(12, wasm.tableGetStructVal(5));
    assertEquals(0, wasm.eq(table.get(4), table.get(5))); // Not the same.
  }
  // Set array.
  table.set(6, wasm.exported(wasm.createArray));
  assertEquals(1, wasm.eq(table.get(6), wasm.tableGet(6)));
  assertEquals(12, wasm.tableGetArrayVal(6));
  wasm.tableSet(7, wasm.createArray);
  assertEquals(1, wasm.eq(table.get(7), wasm.tableGet(7)));
  assertEquals(12, wasm.tableGetArrayVal(7));
  assertEquals(0, wasm.eq(table.get(6), table.get(7))); // Not the same.

  // Ensure all objects are externalized, so they can be handled by JS.
  for (let i = 0; i < size; ++i) {
    JSON.stringify(table.get(i));
  }
}
