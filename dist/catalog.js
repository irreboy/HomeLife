/* Catálogo de alimentos de la pauta, pasillos de supermercado y unidades.
 *
 * Vive aparte porque lo usan la compra, la despensa y el recetario.
 * El catálogo es cerrado a propósito: son los alimentos indicados. Se pueden
 * agregar productos propios, pero quedan marcados como fuera de la pauta.
 */

export const CARBS = [
  "Avena integral", "Quínoa", "Lentejas", "Garbanzos", "Porotos", "Papa con piel",
  "Camote", "Plátano verde", "Yuca", "Arroz integral", "Pan integral", "Arepa integral"
];

export const GROCERIES = {
  "Verduras": ["Espinaca", "Acelga", "Lechuga", "Rúcula", "Brócoli", "Coliflor", "Repollo", "Zapallo italiano", "Pepino", "Apio", "Berenjena", "Pimentón", "Espárragos", "Alcachofa", "Tomate", "Cebolla", "Ajo", "Zanahoria", "Champiñones", "Porotos verdes"],
  "Proteínas": ["Pollo", "Pavo", "Pescado", "Carne magra", "Mariscos", "Huevos", "Atún al agua"],
  "Frutas": ["Frutilla", "Arándano", "Manzana verde", "Kiwi", "Ciruela", "Pomelo", "Naranja", "Pera"],
  "Grasas saludables": ["Palta", "Aceitunas", "Frutos secos naturales", "Chía", "Linaza molida", "Semillas de girasol molidas", "Aceite de oliva"],
  "Carbohidratos": CARBS,
  "Otros permitidos": ["Gelatina sin azúcar", "Jalea sin azúcar", "Canela", "Jengibre", "Té verde", "Vinagre", "Orégano", "Comino", "Cilantro", "Perejil", "Limón"]
};

export const SHOP_UNITS = ["unidad", "g", "kg", "mg", "ml", "L", "paquete", "bandeja", "docena", "atado", "manojo"];

/** Orden de recorrido del supermercado. */
export const AISLES = [
  "Verduras y frutas",
  "Carnicería y pescadería",
  "Huevos y lácteos",
  "Abarrotes",
  "Frutos secos y semillas",
  "Otros"
];

const AISLE_BY_CATEGORY = {
  "Verduras": "Verduras y frutas",
  "Frutas": "Verduras y frutas",
  "Proteínas": "Carnicería y pescadería",
  "Grasas saludables": "Frutos secos y semillas",
  "Carbohidratos": "Abarrotes",
  "Otros permitidos": "Abarrotes"
};

// Excepciones donde el pasillo no coincide con la categoría nutricional.
const AISLE_OVERRIDES = {
  "Huevos": "Huevos y lácteos",
  "Palta": "Verduras y frutas",
  "Aceitunas": "Abarrotes",
  "Aceite de oliva": "Abarrotes",
  "Limón": "Verduras y frutas",
  "Cilantro": "Verduras y frutas",
  "Perejil": "Verduras y frutas",
  "Jengibre": "Verduras y frutas",
  "Atún al agua": "Abarrotes",
  "Papa con piel": "Verduras y frutas",
  "Camote": "Verduras y frutas",
  "Plátano verde": "Verduras y frutas",
  "Yuca": "Verduras y frutas"
};

const CATEGORY_BY_FOOD = new Map();
for (const [category, items] of Object.entries(GROCERIES)) {
  for (const item of items) CATEGORY_BY_FOOD.set(item, category);
}

export function categoryOf(name) { return CATEGORY_BY_FOOD.get(name) || null; }
export function isInGuideline(name) { return CATEGORY_BY_FOOD.has(name); }
export function aisleOf(name) {
  if (AISLE_OVERRIDES[name]) return AISLE_OVERRIDES[name];
  const category = CATEGORY_BY_FOOD.get(name);
  return (category && AISLE_BY_CATEGORY[category]) || "Otros";
}

export const FOOD_TASKS = [
  ["breakfast-veg", "Verduras", "Desayuno"], ["breakfast-protein", "Proteína", "Desayuno"],
  ["lunch-veg", "Verduras", "Almuerzo"], ["lunch-protein", "Proteína", "Almuerzo"],
  ["dinner-veg", "Verduras", "Cena"], ["dinner-protein", "Proteína", "Cena"],
  ["fruit", "Porción de fruta", "Una vez al día · aprox. 150 g"],
  ["fat", "Grasa saludable", "Una vez al día · aprox. 30 g"]
];

export const CATEGORY_SYMBOL = { "Verduras": "V", "Proteínas": "P", "Frutas": "F", "Grasas saludables": "G", "Carbohidratos": "C", "Otros permitidos": "+" };
export const CATEGORY_HINT = {
  "Verduras": "Cantidad libre según pauta",
  "Proteínas": "Para las comidas principales",
  "Frutas": "Una porción al día",
  "Grasas saludables": "Una porción al día",
  "Carbohidratos": "Máx. una porción diaria",
  "Otros permitidos": "Opción permitida"
};

/** "1 comprimido" / "8 comprimidos": pluraliza salvo que la unidad ya lo esté. */
export function unitLabel(amount, unit = "unidad") {
  const text = String(unit || "unidad").trim();
  if (Number(amount) === 1 || !text || text.endsWith("s")) return text;
  return /[aeiouáéíóú]$/i.test(text) ? `${text}s` : `${text}es`;
}
