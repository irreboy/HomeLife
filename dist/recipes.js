/* Recetario de la pauta.
 *
 * Cada ingrediente apunta, cuando se puede, a un alimento del catálogo: así la
 * receta sabe qué hay en casa y qué falta comprar. Las cantidades son por
 * porción, de modo que escalar a más comensales es una multiplicación.
 *
 * Son ideas de organización familiar basadas en la pauta cargada; no sustituyen
 * la indicación de la nutricionista.
 */

import { CARBS, unitLabel } from "./catalog.js";

/** `food` enlaza con el catálogo; `label` se usa cuando no es un producto comprable. */
const r = (id, name, minutes, meals, tags, ingredients, steps, note = "") =>
  ({ id, name, minutes, meals, tags, ingredients, steps, note });

export const RECIPES = [
  r("pollo-verde", "Pollo con brócoli y zapallo italiano", 30, ["Almuerzo", "Cena"], ["Sin carbohidrato", "Al sartén"],
    [
      { food: "Pollo", qty: 150, unit: "g" },
      { food: "Brócoli", qty: 0.5, unit: "unidad" },
      { food: "Zapallo italiano", qty: 0.5, unit: "unidad" },
      { food: "Pimentón", qty: 0.25, unit: "unidad" },
      { food: "Jengibre", qty: 1, unit: "unidad", optional: true },
      { food: "Aceite de oliva", qty: 5, unit: "ml" }
    ],
    ["Cortar el pollo en cubos y las verduras en trozos parejos.",
     "Cocinar el pollo en el sartén hasta que esté completamente cocido por dentro.",
     "Agregar las verduras y el jengibre; saltear hasta que queden tiernas pero firmes.",
     "Servir sin añadir otro carbohidrato si la porción diaria ya fue utilizada."]),

  r("pescado-coliflor", "Pescado al horno con coliflor", 35, ["Almuerzo", "Cena"], ["Sin carbohidrato", "Al horno"],
    [
      { food: "Pescado", qty: 150, unit: "g" },
      { food: "Coliflor", qty: 0.5, unit: "unidad" },
      { food: "Pimentón", qty: 0.25, unit: "unidad" },
      { food: "Espárragos", qty: 4, unit: "unidad" },
      { food: "Limón", qty: 0.5, unit: "unidad" },
      { food: "Aceite de oliva", qty: 5, unit: "ml" }
    ],
    ["Calentar el horno a temperatura media-alta.",
     "Disponer el pescado y las verduras en una fuente, con un hilo de aceite y limón.",
     "Hornear hasta que el pescado esté completamente cocido y se separe en láminas.",
     "Acompañar con verduras frescas permitidas."]),

  r("ensalada-lentejas", "Ensalada tibia de lentejas", 25, ["Almuerzo"], ["Usa el carbohidrato", "Vegetariana"],
    [
      { food: "Lentejas", qty: 100, unit: "g" },
      { food: "Espinaca", qty: 1, unit: "manojo" },
      { food: "Pepino", qty: 0.5, unit: "unidad" },
      { food: "Pimentón", qty: 0.25, unit: "unidad" },
      { food: "Huevos", qty: 1, unit: "unidad" },
      { food: "Aceite de oliva", qty: 5, unit: "ml" }
    ],
    ["Escurrir las lentejas cocidas y dejarlas entibiar.",
     "Mezclar con la espinaca, el pepino y el pimentón picados.",
     "Agregar el huevo completamente cocido, cortado en cuartos.",
     "Esta preparación utiliza la porción diaria de carbohidrato complejo."],
    "Usa la porción diaria de carbohidrato."),

  r("pavo-palta", "Rollitos de pavo, palta y rúcula", 15, ["Cena", "Desayuno"], ["Sin cocción", "Rápida"],
    [
      { food: "Pavo", qty: 150, unit: "g" },
      { food: "Palta", qty: 0.25, unit: "unidad" },
      { food: "Rúcula", qty: 1, unit: "manojo" },
      { food: "Pepino", qty: 0.5, unit: "unidad" },
      { food: "Limón", qty: 0.25, unit: "unidad" }
    ],
    ["Cocinar completamente el pavo y cortarlo en láminas delgadas.",
     "Rellenar cada lámina con rúcula y bastones de pepino.",
     "Distribuir la palta considerando la única porción diaria de grasa saludable.",
     "Aliñar con unas gotas de limón."],
    "Usa la porción diaria de grasa saludable."),

  r("tortilla-verduras", "Tortilla de espinaca y champiñones", 20, ["Desayuno", "Cena"], ["Rápida", "Vegetariana"],
    [
      { food: "Huevos", qty: 2, unit: "unidad" },
      { food: "Espinaca", qty: 1, unit: "manojo" },
      { food: "Champiñones", qty: 80, unit: "g" },
      { food: "Cebolla", qty: 0.25, unit: "unidad" },
      { food: "Aceite de oliva", qty: 5, unit: "ml" }
    ],
    ["Saltear la cebolla y los champiñones hasta dorar.",
     "Agregar la espinaca y cocinar hasta que reduzca.",
     "Verter los huevos batidos y cocinar a fuego suave hasta cuajar por completo.",
     "Servir con ensalada fresca."]),

  r("crema-zapallo", "Crema de zapallo italiano y apio", 25, ["Cena"], ["Sopa", "Vegetariana"],
    [
      { food: "Zapallo italiano", qty: 1, unit: "unidad" },
      { food: "Apio", qty: 2, unit: "unidad" },
      { food: "Cebolla", qty: 0.25, unit: "unidad" },
      { food: "Ajo", qty: 1, unit: "unidad" },
      { food: "Aceite de oliva", qty: 5, unit: "ml" }
    ],
    ["Sofreír la cebolla y el ajo.",
     "Agregar el zapallo italiano y el apio en trozos, cubrir con agua.",
     "Cocinar hasta que estén blandos y licuar hasta obtener una crema.",
     "Ajustar el espesor con agua caliente; no agregar crema ni espesantes."]),

  r("pollo-horno-verduras", "Pollo al horno con verduras de raíz", 45, ["Almuerzo"], ["Al horno", "Para compartir"],
    [
      { food: "Pollo", qty: 150, unit: "g" },
      { food: "Zanahoria", qty: 1, unit: "unidad" },
      { food: "Cebolla", qty: 0.5, unit: "unidad" },
      { food: "Pimentón", qty: 0.5, unit: "unidad" },
      { food: "Orégano", qty: 1, unit: "unidad", optional: true },
      { food: "Aceite de oliva", qty: 5, unit: "ml" }
    ],
    ["Precalentar el horno.",
     "Disponer el pollo sobre las verduras cortadas en bastones.",
     "Hornear hasta que el pollo esté completamente cocido y las verduras doradas.",
     "Dejar reposar unos minutos antes de servir."]),

  r("ensalada-atun", "Ensalada de atún, tomate y aceitunas", 12, ["Almuerzo", "Cena"], ["Sin cocción", "Rápida"],
    [
      { food: "Atún al agua", qty: 1, unit: "unidad" },
      { food: "Tomate", qty: 1, unit: "unidad" },
      { food: "Lechuga", qty: 1, unit: "manojo" },
      { food: "Aceitunas", qty: 5, unit: "unidad" },
      { food: "Aceite de oliva", qty: 5, unit: "ml" }
    ],
    ["Escurrir bien el atún al agua.",
     "Mezclar con el tomate en cubos y la lechuga.",
     "Agregar las aceitunas contando la porción diaria de grasa saludable.",
     "Aliñar con un hilo de aceite de oliva y vinagre."],
    "Usa la porción diaria de grasa saludable."),

  r("garbanzos-espinaca", "Garbanzos guisados con espinaca", 30, ["Almuerzo"], ["Usa el carbohidrato", "Vegetariana"],
    [
      { food: "Garbanzos", qty: 100, unit: "g" },
      { food: "Espinaca", qty: 1, unit: "manojo" },
      { food: "Tomate", qty: 1, unit: "unidad" },
      { food: "Ajo", qty: 1, unit: "unidad" },
      { food: "Comino", qty: 1, unit: "unidad", optional: true }
    ],
    ["Sofreír el ajo y el tomate picado.",
     "Agregar los garbanzos cocidos y un poco de agua.",
     "Incorporar la espinaca al final y cocinar hasta que reduzca.",
     "Esta preparación utiliza la porción diaria de carbohidrato complejo."],
    "Usa la porción diaria de carbohidrato."),

  r("avena-fruta", "Avena con fruta y canela", 10, ["Desayuno"], ["Usa el carbohidrato", "Rápida"],
    [
      { food: "Avena integral", qty: 40, unit: "g" },
      { food: "Arándano", qty: 60, unit: "g" },
      { food: "Canela", qty: 1, unit: "unidad" },
      { food: "Chía", qty: 5, unit: "g", optional: true }
    ],
    ["Cocinar la avena con agua hasta espesar.",
     "Agregar la canela y revolver.",
     "Servir con la fruta encima; esta es la porción diaria de fruta.",
     "Esta preparación utiliza la porción diaria de carbohidrato complejo."],
    "Usa las porciones diarias de carbohidrato y fruta."),

  r("mariscos-salteados", "Salteado de mariscos con verduras", 20, ["Almuerzo", "Cena"], ["Sin carbohidrato", "Rápida"],
    [
      { food: "Mariscos", qty: 150, unit: "g" },
      { food: "Porotos verdes", qty: 100, unit: "g" },
      { food: "Pimentón", qty: 0.5, unit: "unidad" },
      { food: "Ajo", qty: 1, unit: "unidad" },
      { food: "Perejil", qty: 1, unit: "manojo", optional: true }
    ],
    ["Saltear el ajo en poco aceite.",
     "Agregar los mariscos y cocinar completamente.",
     "Incorporar las verduras y saltear a fuego fuerte unos minutos.",
     "Terminar con perejil fresco picado."]),

  r("berenjena-horno", "Berenjena al horno con tomate", 40, ["Cena"], ["Al horno", "Vegetariana"],
    [
      { food: "Berenjena", qty: 1, unit: "unidad" },
      { food: "Tomate", qty: 2, unit: "unidad" },
      { food: "Ajo", qty: 1, unit: "unidad" },
      { food: "Orégano", qty: 1, unit: "unidad", optional: true },
      { food: "Aceite de oliva", qty: 5, unit: "ml" }
    ],
    ["Cortar la berenjena en láminas y salarla unos minutos para quitar el amargor.",
     "Alternar capas de berenjena y tomate en una fuente.",
     "Hornear hasta que la berenjena esté tierna.",
     "Acompañar con una proteína de la pauta."])
];

const CARB_SET = new Set(CARBS);

/** Cantidades escaladas al número de porciones pedido. */
export function scaleRecipe(recipe, servings = 1) {
  return recipe.ingredients.map(ingredient => {
    const qty = Number((ingredient.qty * servings).toFixed(2));
    return { ...ingredient, qty, display: formatQty(qty, ingredient.unit) };
  });
}

export function formatQty(qty, unit) {
  const rounded = Math.round(qty * 100) / 100;
  const text = Number.isInteger(rounded) ? String(rounded) : String(rounded).replace(".", ",");
  return `${text} ${unitLabel(rounded, unit)}`;
}

export function usesCarbohydrate(recipe) {
  return recipe.ingredients.some(ingredient => CARB_SET.has(ingredient.food));
}

/**
 * Compara la receta con la despensa.
 * `pantry` es un objeto { nombre: { available: boolean } }.
 */
export function pantryMatch(recipe, pantry = {}) {
  const required = recipe.ingredients.filter(ingredient => !ingredient.optional);
  const missing = required.filter(ingredient => !pantry[ingredient.food]?.available);
  return {
    total: required.length,
    have: required.length - missing.length,
    missing: missing.map(ingredient => ingredient.food),
    complete: missing.length === 0,
    percent: required.length ? Math.round(((required.length - missing.length) / required.length) * 100) : 100
  };
}

/** Busca por nombre, etiqueta, comida o ingrediente. */
export function searchRecipes(recipes, query) {
  const term = query.trim().toLowerCase();
  if (!term) return recipes;
  return recipes.filter(recipe =>
    recipe.name.toLowerCase().includes(term)
    || recipe.tags.some(tag => tag.toLowerCase().includes(term))
    || recipe.meals.some(meal => meal.toLowerCase().includes(term))
    || recipe.ingredients.some(ingredient => String(ingredient.food || "").toLowerCase().includes(term))
  );
}
