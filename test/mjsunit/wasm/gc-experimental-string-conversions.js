// Copyright 2022 the V8 project authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

// Flags: --experimental-wasm-gc --wasm-gc-js-interop

d8.file.execute('test/mjsunit/wasm/wasm-module-builder.js');

var builder = new WasmModuleBuilder();

let i16Array = builder.addArray(kWasmI16, true);

builder.addFunction('getHelloArray', makeSig([], [kWasmArrayRef]))
    .addBody([
      ...wasmI32Const(72), ...wasmI32Const(69), ...wasmI32Const(76),
      ...wasmI32Const(76), ...wasmI32Const(79),
      kGCPrefix, kExprArrayNewFixedStatic, i16Array, 5
    ])
    .exportFunc();

builder.addFunction('getChar', makeSig([kWasmArrayRef, kWasmI32], [kWasmI32]))
    .addBody([
      kExprLocalGet, 0, kGCPrefix, kExprRefAsData, kGCPrefix,
      kExprRefCastStatic, i16Array, kExprLocalGet, 1, kGCPrefix, kExprArrayGetS,
      i16Array
    ])
    .exportFunc();

const instance = builder.instantiate();
const getHelloArray = instance.exports.getHelloArray;
const getChar = instance.exports.getChar;

assertEquals(
    WebAssembly.experimentalConvertArrayToString(getHelloArray(), 0, 5),
    'HELLO');
assertEquals(
    WebAssembly.experimentalConvertArrayToString(getHelloArray(), 1, 4),
    'ELLO');
assertEquals(
    WebAssembly.experimentalConvertArrayToString(getHelloArray(), 0, 3), 'HEL');

const string = 'foobar'
const array =
    WebAssembly.experimentalConvertStringToArray('foobar', getHelloArray());
for (let i = 0; i < string.length; ++i) {
  assertEquals(getChar(array, i), string.charCodeAt(i));
}
