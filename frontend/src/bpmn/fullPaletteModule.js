/**
 * Módulo didi que reemplaza el PaletteProvider nativo de bpmn-js
 * por uno completo (todos los elementos BPMN 2.0).
 *
 * Al declarar `paletteProvider` con el mismo nombre que usa bpmn-js,
 * sobreescribimos el provider por defecto.
 */
import FullPaletteProvider from "./FullPaletteProvider";

export default {
  __init__: ["paletteProvider"],
  paletteProvider: ["type", FullPaletteProvider],
};
