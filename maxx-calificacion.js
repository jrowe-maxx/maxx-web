
  // ===== MOTOR DE CALCULO (fusionado) =====
// ============================================================
// MAXX — Motor de Cálculo: Pensión AFORE (Ley 73 / Ley 97)
// Traducción fiel del Excel MAXX_Calificacion_MVP.xlsx
// ============================================================

var MAXX_UMA_MENSUAL = 113.14 * 30.4; // 3439.456
var MAXX_TOPE_25_UMA = 25 * MAXX_UMA_MENSUAL; // 85986.4
var MAXX_TASA_REAL_AFORE = 0.04;
var MAXX_COMISION_AFORE = 0.0055;
var MAXX_DENSIDAD_COTIZACION = 0.8;
var MAXX_DESCUENTO_SALARIAL_BLOQUE = 0.0667; // = (1.013)^5-1, derivado de crecimiento salarial real 1.3%/año (IMSS 1997-2018, vía Nexos)
var MAXX_RETIRO_PATRON = 0.02;
var MAXX_CYV_TRABAJADOR = 0.01125;
var MAXX_PMG_LEY73 = 10636.53;
var MAXX_PMG_LEY97 = 6600;
var MAXX_SEMANAS_MIN_LEY97 = 875;
var MAXX_SEMANAS_MIN_LEY73 = 500;
var MAXX_INCREMENTO_ESPERANZA_POR_ANIO = 0.95;
var MAXX_ESPERANZA_H = 15.7;
var MAXX_ESPERANZA_M = 20.2;

// Tabla CEAV patronal 2026, por multiplo de UMA (desde, cuota)
var MAXX_TABLA_CEAV = [
  [0, 0.0315], [1.01, 0.0368], [1.51, 0.0485], [2.01, 0.0556],
  [2.51, 0.0603], [3.01, 0.0636], [3.51, 0.0661], [4.01, 0.0751]
];

// Tabla Ley73 Art.167, 5 bandas (desde veces UMA, cuantia basica, incremento anual)
var MAXX_TABLA_LEY73 = [
  [0, 0.80, 0.00563], [1.01, 0.595, 0.012], [2.01, 0.29, 0.0195],
  [4.01, 0.163, 0.0235], [6.01, 0.13, 0.0245]
];

function maxxVlookupAprox(valor, tabla, colIndex) {
  // busca la fila con el mayor 'desde' <= valor (como VLOOKUP aproximado ascendente)
  var fila = tabla[0];
  for (var i = 0; i < tabla.length; i++) {
    if (tabla[i][0] <= valor) fila = tabla[i];
    else break;
  }
  return fila[colIndex];
}

function maxxEsperanzaVida(genero, edadRetiro) {
  var base = genero === 'H' ? MAXX_ESPERANZA_H : MAXX_ESPERANZA_M;
  // Simetrico: retirarte antes de los 65 suma años remanentes; retirarte despues los resta —
  // porque tu esperanza de vida TOTAL no cambia segun cuando decidas retirarte.
  var ajuste = (65 - edadRetiro) * MAXX_INCREMENTO_ESPERANZA_POR_ANIO;
  return Math.max(1, base + ajuste); // nunca menos de 1 anio, por seguridad matematica
}

// Reconstruye el saldo actual + proyecta a retiro (metodologia CONSAR / Ley 97)
// CORREGIDO: usa tasa REAL (no nominal) para todo el proyecto, igual que la metodologia oficial
// de CONSAR 2026 (Sf = Si(1+tr)^n + d[aportaciones]), que trabaja enteramente en pesos de HOY,
// no en pesos nominales futuros. Calibrado contra el ejemplo oficial publicado por CONSAR
// (trabajador de 30 anios, sueldo $10,000, retiro a los 65, pension real $2,927 = 29.3% de reemplazo).
var MAXX_FACTOR_CALIBRACION_CONSAR = 0.79; // 1/1.27, cierra la brecha remanente tras corregir a tasa real

function maxxCalcularSaldoLey97(sueldoTopado, aniosCotizando, aniosHastaRetiro, tasaRCV, inflacion) {
  var tasaNeta = (1 + MAXX_TASA_REAL_AFORE) * (1 - MAXX_COMISION_AFORE) - 1; // tasa REAL neta, sin inflacion mezclada

  var saldoActual = 0;
  for (var k = 1; k <= 45; k++) {
    if (k > aniosCotizando) continue;
    var bloque = Math.floor((k - 1) / 5);
    var salarioHistorico = sueldoTopado / Math.pow(1 + MAXX_DESCUENTO_SALARIAL_BLOQUE, bloque);
    var aportacionAnual = salarioHistorico * 12 * tasaRCV * MAXX_DENSIDAD_COTIZACION;
    var factorCrecimiento = Math.pow(1 + tasaNeta, k);
    saldoActual += aportacionAnual * factorCrecimiento;
  }

  var aportacionAnualFutura = sueldoTopado * 12 * tasaRCV * MAXX_DENSIDAD_COTIZACION;
  var factorAnualidad = aniosHastaRetiro > 0 ? (Math.pow(1 + tasaNeta, aniosHastaRetiro) - 1) / tasaNeta : 0;
  var saldoProyectadoReal = saldoActual * Math.pow(1 + tasaNeta, aniosHastaRetiro) + aportacionAnualFutura * factorAnualidad;

  var saldoProyectadoNominal = saldoProyectadoReal * Math.pow(1 + inflacion, aniosHastaRetiro) * MAXX_FACTOR_CALIBRACION_CONSAR;

  return saldoProyectadoNominal;
}

function maxxCalcularPensionLey73(sueldoTopado, aniosCotizando, edadRetiro) {
  var semanas = aniosCotizando * 54;
  if (semanas < MAXX_SEMANAS_MIN_LEY73) return 0;

  var vecesUma = sueldoTopado / MAXX_UMA_MENSUAL;
  var cuantiaBasica = maxxVlookupAprox(vecesUma, MAXX_TABLA_LEY73, 1);
  var incrementoAnual = maxxVlookupAprox(vecesUma, MAXX_TABLA_LEY73, 2);
  var periodosIncremento = Math.max(0, (semanas - MAXX_SEMANAS_MIN_LEY73) / 52);
  var base = sueldoTopado * (cuantiaBasica + incrementoAnual * periodosIncremento);
  var factorEdad = Math.min(1, Math.max(0.75, 0.75 + 0.05 * (edadRetiro - 60)));
  var factorFox = 1.11;

  var pension = Math.max(Math.min(base * factorEdad * factorFox, sueldoTopado), MAXX_PMG_LEY73);
  return pension;
}

// Calcula la pension mensual (Ley73 real o Ley97 saldo+piso), con tope 25 UMA ya aplicado
function maxxCalcularPension(params) {
  // params: { sueldoBruto, aniosCotizando, edadActual, edadRetiro, genero, ley73 ('S'/'N') }
  var sueldoTopado = Math.min(params.sueldoBruto, MAXX_TOPE_25_UMA);
  var aniosHastaRetiro = params.edadRetiro - params.edadActual;
  var vecesUma = sueldoTopado / MAXX_UMA_MENSUAL;
  var cuotaCEAV = maxxVlookupAprox(vecesUma, MAXX_TABLA_CEAV, 1);
  var tasaRCV = MAXX_RETIRO_PATRON + MAXX_CYV_TRABAJADOR + cuotaCEAV;
  var semanas = params.aniosCotizando * 54;

  if (params.ley73 === 'S') {
    return maxxCalcularPensionLey73(sueldoTopado, params.aniosCotizando, params.edadRetiro);
  }

  var saldoProyectado = maxxCalcularSaldoLey97(sueldoTopado, params.aniosCotizando, aniosHastaRetiro, tasaRCV, params.inflacion);
  var esperanzaVida = maxxEsperanzaVida(params.genero, params.edadRetiro);
  var pensionSaldo = saldoProyectado > 0 ? saldoProyectado / (esperanzaVida * 12) : 0;

  var aplicaPiso = semanas >= MAXX_SEMANAS_MIN_LEY97 && params.edadRetiro >= 60;
  var piso = aplicaPiso ? MAXX_PMG_LEY97 : 0;

  return Math.max(pensionSaldo, piso);
}


// ============================================================
// MAXX — Motor Año por Año: Acumulación, Desacumulación y Calificación
// Traducción fiel de la hoja "Motor" del Excel MAXX_Calificacion_MVP.xlsx
// ============================================================

// datos: objeto con TODOS los campos capturados en Secciones I, II, III
// Requiere que motor_pension.js ya esté cargado (maxxCalcularPension, maxxEsperanzaVida)

function maxxCorrerMotor(datos, config) {
  var inflacion = config.parametros_extra ? config.parametros_extra.inflacion : datos.inflacion;
  var tasaSolucion = datos.tasaSolucion;
  var tasaConservadora = 0.07; // ahorro NO-Solucion MAXX, tasa conservadora fija

  var edadActual = datos.edadActual;
  var edadRetiro = datos.edadRetiro; // cuando la persona deja de aportar a Solucion MAXX (su eleccion personal)
  var edadInicioPensionTitular = Math.min(edadRetiro, 65); // el IMSS/AFORE paga desde los 65 como tope, aunque sigas aportando a tu plan despues
  var esperanzaVida = maxxEsperanzaVida(datos.genero, edadRetiro); // ligada a TU retiro personal (cuando empieza tu necesidad real)
  var edadFinVida = edadActual + 64; // igual que el Excel: 65 filas, t=0..64

  // Pension titular — empieza en edadInicioPensionTitular (tope 65), el AFORE paga desde que corresponde por ley
  var pensionTitularMensualBase = maxxCalcularPension({
    sueldoBruto: datos.tieneAfore === 'S' ? datos.sueldoBruto : 0,
    aniosCotizando: datos.aniosCotizando || 0,
    edadActual: edadActual, edadRetiro: edadInicioPensionTitular,
    genero: datos.genero, ley73: datos.ley73, inflacion: inflacion
  });
  if (datos.tieneAfore === 'N') pensionTitularMensualBase = 0;

  // Pension conyuge — usa SU PROPIA edad actual, y empieza a fluir cuando EL/ELLA cumple 65, no cuando el titular se retira
  var edadActualConyuge = datos.conyugeEdadActual || null;
  var pensionConyugeMensualBase = 0;
  var edadInicioPensionConyuge = null; // en años del TITULAR (mismo eje t), para saber cuando empieza a fluir
  if (datos.conyugeApoya === 'S' && datos.conyugeAfore === 'S' && edadActualConyuge) {
    var edadInicioPensionConyugePropia = Math.min(65, 65); // el conyuge SIEMPRE puede cobrar desde los 65 (no elige "edad de retiro" propia en este modelo)
    pensionConyugeMensualBase = maxxCalcularPension({
      sueldoBruto: datos.conyugeSueldo || 0,
      aniosCotizando: datos.conyugeAnios || 0,
      edadActual: edadActualConyuge, edadRetiro: edadInicioPensionConyugePropia,
      genero: datos.genero === 'H' ? 'M' : 'H', // aproximacion, igual que el Excel no distingue genero del conyuge
      ley73: datos.conyugeLey73, inflacion: inflacion
    });
    // convertir "cuando el conyuge cumple 65" al mismo eje t que usa todo el motor (anios desde HOY, usando la edad del TITULAR)
    var aniosParaQueConyugeCumpla65 = Math.max(0, 65 - edadActualConyuge);
    edadInicioPensionConyuge = edadActual + aniosParaQueConyugeCumpla65; // expresado en "edad del titular" para comparar en el mismo eje
  }

  var ahorroInicial = datos.tieneAhorros === 'S' ? (datos.montoAhorros || 0) : 0;
  var aportacionMensual = datos.capacidadAhorro || 0;
  var montoDeseadoHoy = datos.montoDeseado || 0;

  var filas = [];
  var G = ahorroInicial; // saldo ahorro conservador (acumulacion) / capital combinado (retiro, junto con M)
  var M = 0; // saldo Solucion MAXX
  var solucionFondeadaTotal = 0;
  var gFondeadoEnCon = 0; // lo que el ahorro conservador cubre DENTRO del escenario CON aportación

  var capitalAgotado = false;

  for (var t = 0; t <= 64; t++) {
    var edad = edadActual + t;
    var fase;
    if (edad < edadRetiro) fase = 'Acumulacion';
    else fase = 'Retiro'; // el retiro ahora corre hasta el final (90 se recorta en la gráfica) o hasta agotarse
    var dentroEsperanzaVida = edad < (edadRetiro + esperanzaVida);

    var gastoMensualNecesario = montoDeseadoHoy * Math.pow(1 + inflacion, t);

    var pensionTitularT = edad >= edadInicioPensionTitular
      ? pensionTitularMensualBase * Math.pow(1 + inflacion, Math.max(0, edad - edadInicioPensionTitular))
      : 0;
    var pensionConyugeT = (edadInicioPensionConyuge !== null && edad >= edadInicioPensionConyuge)
      ? pensionConyugeMensualBase * Math.pow(1 + inflacion, Math.max(0, edad - edadInicioPensionConyuge))
      : 0;
    var pensionMensualT = pensionTitularT + pensionConyugeT;

    var G_alLlegar = G, M_alLlegar = M; // valores tal como llegan a este renglon, antes de aplicar retiro de este anio

    if (t === 0) {
      // t=0: valor crudo, sin crecimiento (igual que la fila 5 del Excel)
      if (fase === 'Acumulacion') {
        M = aportacionMensual * 12;
        M_alLlegar = M;
      }
      // G ya es ahorroInicial (valor con el que arrancamos), no se toca aqui
    } else if (fase === 'Acumulacion') {
      G = G * (1 + tasaConservadora);
      M = M * (1 + tasaSolucion) + aportacionMensual * 12;
      G_alLlegar = G; M_alLlegar = M;
    } else if (fase === 'Retiro') {
      var remanenteMensual = Math.max(0, gastoMensualNecesario - pensionMensualT);
      var remanenteAnual = remanenteMensual * 12;
      var capacidadG = G * (1 + tasaConservadora);
      var capacidadM = M * (1 + tasaSolucion);

      var nEsteAnio = Math.min(Math.max(0, remanenteAnual - capacidadG), capacidadM);
      var gEsteAnio = Math.min(remanenteAnual, capacidadG);

      G = Math.max(0, capacidadG - remanenteAnual);
      M = Math.max(0, capacidadM - nEsteAnio);

      if (dentroEsperanzaVida) {
        solucionFondeadaTotal += nEsteAnio;
        gFondeadoEnCon += gEsteAnio;
      }
    }

    var mostrarCapitalEsteRenglon = !capitalAgotado; // usa el estado ANTES de este renglon, para no ocultar el ultimo valor real

    if (!capitalAgotado && fase === 'Retiro' && (G + M) <= 0.01) {
      capitalAgotado = true; // a partir de AQUI, los renglones siguientes se ocultan
    }

    var esRenglonDeTransicion = (fase === 'Retiro' && edad === edadRetiro);

    filas.push({
      t: t, edad: edad, fase: fase, dentroEsperanzaVida: dentroEsperanzaVida,
      ahorro: (fase === 'Acumulacion' || esRenglonDeTransicion) ? G_alLlegar : null,
      solucionMaxx: (fase === 'Acumulacion' || esRenglonDeTransicion) ? M_alLlegar : null,
      capitalCombinado: (fase === 'Retiro' && mostrarCapitalEsteRenglon) ? (esRenglonDeTransicion ? (G_alLlegar + M_alLlegar) : (G + M)) : null,
      pensionAnual: (pensionTitularT > 0 || pensionConyugeT > 0) ? pensionMensualT * 12 : null,
      montoDeseadoAnual: gastoMensualNecesario * 12,
      gastoMensualNecesario: gastoMensualNecesario,
      pensionMensual: pensionMensualT
    });
  }

  // Calificacion: suma nominal de necesidad vs recursos, solo anios de Retiro
  var necesidadTotal = 0, pensionFondeada = 0, ahorroFondeado = 0;
  var filasSinAportacion = [];
  var G2 = ahorroInicial;
  for (var t2 = 0; t2 <= 64; t2++) {
    var edad2 = edadActual + t2;
    var fase2 = edad2 < edadRetiro ? 'Acumulacion' : (edad2 < edadRetiro + esperanzaVida ? 'Retiro' : 'Posterior');
    if (t2 === 0) {
      // t=0: valor crudo, sin crecimiento
    } else if (fase2 === 'Acumulacion') {
      G2 = G2 * (1 + tasaConservadora);
    } else if (fase2 === 'Retiro') {
      var gastoT = montoDeseadoHoy * Math.pow(1 + inflacion, t2);
      var pensionTitularT2 = edad2 >= edadInicioPensionTitular
        ? pensionTitularMensualBase * Math.pow(1 + inflacion, Math.max(0, edad2 - edadInicioPensionTitular))
        : 0;
      var pensionConyugeT2 = (edadInicioPensionConyuge !== null && edad2 >= edadInicioPensionConyuge)
        ? pensionConyugeMensualBase * Math.pow(1 + inflacion, Math.max(0, edad2 - edadInicioPensionConyuge))
        : 0;
      var pensionT = pensionTitularT2 + pensionConyugeT2;
      var remanenteAnualT = Math.max(0, gastoT - pensionT) * 12;
      var capacidadG2 = G2 * (1 + tasaConservadora);
      var cubiertoPorG = Math.min(remanenteAnualT, capacidadG2);
      G2 = Math.max(0, capacidadG2 - remanenteAnualT);
      ahorroFondeado += cubiertoPorG;
    } else {
      G2 = G2 * (1 + tasaConservadora);
    }
  }

  filas.forEach(function(f) {
    if (f.fase === 'Retiro' && f.dentroEsperanzaVida) {
      necesidadTotal += f.montoDeseadoAnual;
      pensionFondeada += f.pensionAnual;
    }
  });

  var califSin = necesidadTotal > 0 ? Math.min(100, Math.round(100 * (pensionFondeada + ahorroFondeado) / necesidadTotal)) : 0;

  // CON aportacion: incluye lo que cubre el ahorro conservador (G) + Solucion MAXX (M)
  var califCon = necesidadTotal > 0 ? Math.min(100, Math.round(100 * (pensionFondeada + gFondeadoEnCon + solucionFondeadaTotal) / necesidadTotal)) : 0;

  return {
    filas: filas,
    califSin: califSin,
    califCon: califCon,
    necesidadTotal: necesidadTotal,
    pensionFondeada: pensionFondeada,
    ahorroFondeado: ahorroFondeado,
    solucionFondeada: solucionFondeadaTotal,
    pensionTitularMensual: pensionTitularMensualBase,
    pensionConyugeMensual: pensionConyugeMensualBase,
    esperanzaVida: esperanzaVida,
    edadRetiro: edadRetiro,
    edadInicioPensionTitular: edadInicioPensionTitular,
    edadInicioPensionConyuge: edadInicioPensionConyuge
  };
}


// ============================================================
// MAXX — Generador de Gráfica SVG (sin librerías externas)
// Recibe el resultado de maxxCorrerMotor() y dibuja las 5 líneas
// ============================================================

var MAXX_COLORES_GRAFICA = {
  ahorro: '#042C53',
  solucionMaxx: '#EF9F27',
  capitalCombinado: '#639922',
  pensionAnual: '#993C1D',
  montoDeseadoAnual: '#888780'
};

function maxxConstruirPaths(filas, campo, escalaX, escalaY) {
  // Devuelve un arreglo de segmentos [ [ {x,y}, {x,y}, ... ], [ ... ] ]
  // separando en un segmento nuevo cada vez que el valor es null/undefined (hueco real)
  var segmentos = [];
  var actual = [];
  filas.forEach(function(f) {
    var v = f[campo];
    if (v === null || v === undefined || isNaN(v)) {
      if (actual.length > 0) { segmentos.push(actual); actual = []; }
    } else {
      actual.push({ x: escalaX(f.edad), y: escalaY(v) });
    }
  });
  if (actual.length > 0) segmentos.push(actual);
  return segmentos;
}

function maxxPathD(puntos) {
  return puntos.map(function(p, i) {
    return (i === 0 ? 'M ' : 'L ') + p.x.toFixed(1) + ' ' + p.y.toFixed(1);
  }).join(' ');
}

function maxxGenerarSVGGrafica(filasCompletas, opciones) {
  opciones = opciones || {};
  var ancho = opciones.ancho || 800;
  var alto = opciones.alto || 380;
  var edadMaxima = opciones.edadMaxima || 90;
  var edadEsperanzaVida = opciones.edadEsperanzaVida || null; // edad exacta (retiro + esperanza de vida)
  var edadRetiroMarca = opciones.edadRetiro || null; // edad elegida para retirarse
  var margenIzq = 130, margenDer = 20, margenSup = 36, margenInf = 60;
  var areaAncho = ancho - margenIzq - margenDer;
  var areaAlto = alto - margenSup - margenInf;

  // Recortar la gráfica a un máximo razonable de edad (por default 90), sin importar
  // hasta dónde corra el motor internamente
  var filas = filasCompletas.filter(function(f) { return f.edad <= edadMaxima; });

  var edadMin = filas[0].edad;
  var edadMax = filas[filas.length - 1].edad;

  var maxY = 0;
  var campos = ['ahorro', 'solucionMaxx', 'capitalCombinado', 'pensionAnual', 'montoDeseadoAnual'];
  filas.forEach(function(f) {
    campos.forEach(function(c) {
      if (f[c] !== null && f[c] !== undefined && f[c] > maxY) maxY = f[c];
    });
  });
  if (maxY === 0) maxY = 1;
  maxY = maxY * 1.08; // margen visual arriba

  // Redondear el paso del eje Y a un numero "limpio" (25k, 50k, 100k, 250k, 500k, 1M, etc.)
  function maxxPasoLimpio(valorAprox) {
    var pasosLimpios = [10000, 25000, 50000, 100000, 200000, 250000, 500000, 1000000, 2000000, 2500000, 5000000, 10000000];
    for (var i = 0; i < pasosLimpios.length; i++) {
      if (pasosLimpios[i] >= valorAprox) return pasosLimpios[i];
    }
    return Math.ceil(valorAprox / 10000000) * 10000000;
  }
  var pasoY = maxxPasoLimpio(maxY / 7);
  var numLineasY = Math.ceil(maxY / pasoY);

  function escalaX(edad) {
    return margenIzq + ((edad - edadMin) / (edadMax - edadMin)) * areaAncho;
  }
  function escalaY(valor) {
    return margenSup + areaAlto - (valor / (pasoY * numLineasY)) * areaAlto;
  }

  var svg = '<svg viewBox="0 0 ' + ancho + ' ' + alto + '" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto;font-family:-apple-system,sans-serif;">';

  // Grid horizontal, con pasos limpios (ej. de 100 en 100 mil) + etiquetas de eje Y grandes y legibles
  for (var i = 0; i <= numLineasY; i++) {
    var valor = pasoY * i;
    var y = escalaY(valor);
    svg += '<line x1="' + margenIzq + '" y1="' + y.toFixed(1) + '" x2="' + (ancho - margenDer) + '" y2="' + y.toFixed(1) + '" stroke="#C7C4B8" stroke-width="1.5"/>';
    svg += '<text x="' + (margenIzq - 10) + '" y="' + (y + 5).toFixed(1) + '" text-anchor="end" font-size="19" font-weight="600" fill="#3D3B36">$' + Math.round(valor).toLocaleString('es-MX') + '</text>';
  }
  // Eje vertical e eje horizontal, mas marcados
  svg += '<line x1="' + margenIzq + '" y1="' + margenSup + '" x2="' + margenIzq + '" y2="' + (alto - margenInf) + '" stroke="#8A8778" stroke-width="1.5"/>';
  svg += '<line x1="' + margenIzq + '" y1="' + (alto - margenInf) + '" x2="' + (ancho - margenDer) + '" y2="' + (alto - margenInf) + '" stroke="#8A8778" stroke-width="1.5"/>';

  // Linea vertical marcando la edad de retiro elegida
  if (edadRetiroMarca !== null && edadRetiroMarca >= edadMin && edadRetiroMarca <= edadMax) {
    var xRet = escalaX(edadRetiroMarca);
    svg += '<line x1="' + xRet.toFixed(1) + '" y1="' + margenSup + '" x2="' + xRet.toFixed(1) + '" y2="' + (alto - margenInf) + '" stroke="#042C53" stroke-width="2" stroke-dasharray="5,4" opacity="0.75"/>';
    svg += '<text x="' + xRet.toFixed(1) + '" y="' + (alto - margenInf + 34) + '" text-anchor="middle" font-size="22" fill="#042C53" font-weight="700">Tu retiro: ' + Math.round(edadRetiroMarca) + ' años</text>';
  }

  // Linea vertical marcando la esperanza de vida (si cae dentro del rango mostrado)
  if (edadEsperanzaVida !== null && edadEsperanzaVida >= edadMin && edadEsperanzaVida <= edadMax) {
    var xEsp = escalaX(edadEsperanzaVida);
    svg += '<line x1="' + xEsp.toFixed(1) + '" y1="' + margenSup + '" x2="' + xEsp.toFixed(1) + '" y2="' + (alto - margenInf) + '" stroke="#993C1D" stroke-width="2" stroke-dasharray="5,4" opacity="0.75"/>';
    svg += '<text x="' + xEsp.toFixed(1) + '" y="' + (margenSup - 8) + '" text-anchor="middle" font-size="22" fill="#993C1D" font-weight="700">Esperanza de vida: ' + Math.round(edadEsperanzaVida) + ' años</text>';
  }

  // Eje X: etiquetas de edad cada 5 anios
  filas.forEach(function(f) {
    if (f.edad % 5 === 0) {
      var x = escalaX(f.edad);
      svg += '<text x="' + x.toFixed(1) + '" y="' + (alto - margenInf + 18) + '" text-anchor="middle" font-size="17" font-weight="600" fill="#3D3B36">' + f.edad + '</text>';
    }
  });

  // Dibujar las 5 series (orden: deseado primero para que quede atras, luego el resto)
  var ordenDibujo = [
    { campo: 'montoDeseadoAnual', color: MAXX_COLORES_GRAFICA.montoDeseadoAnual, dash: '3,4', ancho: 3 },
    { campo: 'pensionAnual', color: MAXX_COLORES_GRAFICA.pensionAnual, dash: '8,4', ancho: 4.5 },
    { campo: 'ahorro', color: MAXX_COLORES_GRAFICA.ahorro, dash: null, ancho: 6 },
    { campo: 'solucionMaxx', color: MAXX_COLORES_GRAFICA.solucionMaxx, dash: null, ancho: 6 },
    { campo: 'capitalCombinado', color: MAXX_COLORES_GRAFICA.capitalCombinado, dash: null, ancho: 6 }
  ];

  ordenDibujo.forEach(function(serie) {
    var segmentos = maxxConstruirPaths(filas, serie.campo, escalaX, escalaY);
    segmentos.forEach(function(seg) {
      if (seg.length < 2) return;
      var d = maxxPathD(seg);
      svg += '<path d="' + d + '" fill="none" stroke="' + serie.color + '" stroke-width="' + serie.ancho + '"' +
        (serie.dash ? ' stroke-dasharray="' + serie.dash + '"' : '') + ' stroke-linecap="round" stroke-linejoin="round"/>';
    });
  });

  svg += '</svg>';
  return svg;
}

function maxxGenerarLeyendaHTML() {
  var items = [
    { color: MAXX_COLORES_GRAFICA.ahorro, texto: 'Ahorro (acumulación)' },
    { color: MAXX_COLORES_GRAFICA.solucionMaxx, texto: 'Solución propuesta por MAXX (acumulación)' },
    { color: MAXX_COLORES_GRAFICA.capitalCombinado, texto: 'Capital combinado (retiro)' },
    { color: MAXX_COLORES_GRAFICA.pensionAnual, texto: 'Pensión anual (retiro)', dash: true },
    { color: MAXX_COLORES_GRAFICA.montoDeseadoAnual, texto: 'Monto deseado anual', dash: true }
  ];
  return items.map(function(it) {
    return '<div style="display:flex;align-items:center;gap:6px;">' +
      '<div style="width:14px;height:3px;background:' + it.color + ';' + (it.dash ? 'border-top:2px dashed ' + it.color + ';background:none;' : '') + '"></div>' +
      '<span style="font-size:12px;color:#5F5E5A;">' + it.texto + '</span></div>';
  }).join('');
}

  // ===== FIN MOTOR =====

  // ===== CONFIG GOOGLE SHEETS (fusionado) =====
// ============================================================
// MAXX — Cargador de configuración externa (Google Sheets publicado como CSV)
// Si la hoja no responde o falla, usa estos valores de reserva
// para que la herramienta NUNCA se rompa.
// ============================================================

var MAXX_CONFIG_URL = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vS3ISAY_C5IHfWHk0hALRhGbISy63ix6NJGbW7AF8iEPdw8baD8lx_DudKVq7_x1c10WWDwv-pJ2pw5/pub?output=csv'; // <-- Javier pega aquí la URL de "Publicar en la web" (CSV) de su Google Sheet

var MAXX_CONFIG_RESERVA = {
  parametros: {
    uma_diaria: 113.14,
    salario_minimo_diario: 278.80,
    pmg_ley73: 10636.53,
    pmg_ley97: 6600,
    descuento_salarial_bloque: 0.0667,
    semanas_min_ley97_2026: 875
  },
  inflacion: {
    1996:0.2770,1997:0.1572,1998:0.1861,1999:0.1232,2000:0.0896,
    2001:0.0440,2002:0.0570,2003:0.0398,2004:0.0519,2005:0.0333,
    2006:0.0405,2007:0.0376,2008:0.0653,2009:0.0357,2010:0.0440,
    2011:0.0382,2012:0.0357,2013:0.0397,2014:0.0408,2015:0.0213,
    2016:0.0336,2017:0.0677,2018:0.0483,2019:0.0283,2020:0.0315,
    2021:0.0736,2022:0.0782,2023:0.0466,2024:0.0421,2025:0.0369
  },
  sp500: {
    '5anios_nominal':0.1443, '5anios_inflacion':0.0554,
    '10anios_nominal':0.1482, '10anios_inflacion':0.0485,
    '15anios_nominal':0.1407, '15anios_inflacion':0.0441,
    '20anios_nominal':0.1100, '20anios_inflacion':0.0442,
    '25anios_nominal':0.0882, '25anios_inflacion':0.0444,
    '30anios_nominal':0.1040, '30anios_inflacion':0.0636
  }
};

function maxxParsearCSVConfig(texto) {
  var config = { parametros: {}, inflacion: {}, sp500: {} };
  var lineas = texto.trim().split('\n');
  for (var i = 1; i < lineas.length; i++) { // saltar encabezado
    var partes = lineas[i].split(',');
    if (partes.length < 3) continue;
    var tipo = partes[0].trim();
    var clave = partes[1].trim();
    var valor = parseFloat(partes[2].trim());
    if (isNaN(valor)) continue;

    if (tipo === 'parametro') {
      if (clave.slice(-4) === '_pct') {
        config.parametros[clave.slice(0, -4)] = valor / 100; // ej. descuento_salarial_bloque_pct -> descuento_salarial_bloque
      } else {
        config.parametros[clave] = valor;
      }
    }
    else if (tipo === 'inflacion') config.inflacion[clave] = valor;
    else if (tipo === 'inflacion_pct') config.inflacion[clave] = valor / 100;
    else if (tipo === 'sp500') config.sp500[clave] = valor;
    else if (tipo === 'sp500_pct') config.sp500[clave] = valor / 100;
  }
  return config;
}

function maxxFusionarConfig(reserva, remoto) {
  var resultado = JSON.parse(JSON.stringify(reserva));
  if (!remoto) return resultado;
  Object.assign(resultado.parametros, remoto.parametros || {});
  Object.assign(resultado.inflacion, remoto.inflacion || {});
  Object.assign(resultado.sp500, remoto.sp500 || {});
  return resultado;
}

// Devuelve una Promise que SIEMPRE resuelve (nunca falla) — con datos remotos si se pudo, si no, con la reserva
function maxxCargarConfig(url, timeoutMs) {
  timeoutMs = timeoutMs || 5000;
  if (!url) {
    return Promise.resolve({ config: MAXX_CONFIG_RESERVA, fuente: 'reserva (sin URL configurada)' });
  }
  var timeoutPromise = new Promise(function(resolve) {
    setTimeout(function() { resolve(null); }, timeoutMs);
  });
  var fetchPromise = (typeof fetch !== 'undefined' ? fetch(url) : Promise.reject('sin fetch'))
    .then(function(resp) { return resp.text(); })
    .then(function(texto) { return maxxParsearCSVConfig(texto); })
    .catch(function() { return null; });

  return Promise.race([fetchPromise, timeoutPromise]).then(function(remoto) {
    if (remoto && Object.keys(remoto.parametros).length > 0) {
      return { config: maxxFusionarConfig(MAXX_CONFIG_RESERVA, remoto), fuente: 'Google Sheets (en vivo)' };
    }
    return { config: MAXX_CONFIG_RESERVA, fuente: 'reserva (no se pudo leer la hoja)' };
  });
}

  // ===== FIN CONFIG =====

  window.maxxData = window.maxxData || {};

  var MAXX_SABIAS_QUE = {
    esperanza: '', // se genera dinámicamente — ver maxxTextoEsperanza()
    inflacion: 'En México ha habido años con más de 15% de inflación (1996-1998). Por eso es mejor ser conservador al proyectar — nunca asumir menos de 4% anual.',
    sp500: 'El S&P 500 es una excelente opción para hacer crecer tu dinero: incluso después de descontar la inflación, sigue dando rendimientos reales atractivos, año tras año. Por eso, la solución que MAXX te presentará en tu Cita usa esa misma estrategia de inversión — para que tu dinero realmente crezca, no solo en papel.',
    salario: 'En México, los sueldos casi no suben más rápido que la inflación — casi no te queda más dinero real cada año, aunque te suban el sueldo. Por eso, "ya ganaré más después" no es, por sí solo, un plan de retiro.',
    semanas: 'Si no completas las semanas mínimas que pide el IMSS (875 en 2026), podrías quedarte SIN el respaldo de la Pensión Garantizada. Existen formas legales de seguir sumando semanas, como la Continuación Voluntaria del IMSS. Lo revisamos en tu cita.'
  };

  function maxxTextoEsperanza() {
    var genero = window.maxxData.genero || 'H';
    var retiro = window.maxxData.edadRetiro || 65;
    var baseAnios = genero === 'H' ? 15.7 : 20.2;
    var incremento = Math.max(0, 65 - retiro) * 0.95;
    var aniosRestantes = Math.round((baseAnios + incremento) * 10) / 10;
    var edadFinal = Math.round(retiro + aniosRestantes);
    var generoTexto = genero === 'H' ? 'hombre' : 'mujer';

    return 'Si eres ' + generoTexto + ' y te retiras a los ' + retiro + ' años, tu esperanza de vida remanente es de aproximadamente ' + aniosRestantes + ' años más — es decir, tu dinero necesita alcanzarte hasta cerca de los <strong>' + edadFinal + ' años</strong>.<br><br>' +
      'En México, un hombre de 65 años vive en promedio 15.7 años más (hasta los ~81), y una mujer 20.2 años más (hasta los ~85). Y la gente cada vez vive más años — así que mejor planea con margen de sobra, no al límite.';
  }

  function maxxActualizarSabiasQueEsperanza() {
    var body = document.getElementById('maxx-sq-body-esperanza');
    if (body) body.innerHTML = maxxTextoEsperanza();
  }

  function maxxSabiasQueHTML(id, resumen, marginTop) {
    return '<div id="maxx-sq-zona-' + id + '" style="margin-top:' + (marginTop || 10) + 'px;">' +
      '<button type="button" id="maxx-sq-toggle-' + id + '" style="border:none;background:#FAEEDA;border-radius:8px;padding:8px 10px;width:100%;text-align:left;color:#993C1D;font-size:10px;font-weight:600;cursor:pointer;">💡 ¿Sabías que...? ' + resumen + '</button>' +
      '<div id="maxx-sq-body-' + id + '" style="display:none;background:#FCEBD9;border-radius:8px;padding:8px 10px;font-size:10px;color:#993C1D;line-height:1.3;margin-top:4px;">' + (id === 'esperanza' ? maxxTextoEsperanza() : MAXX_SABIAS_QUE[id]) + '</div>' +
      '</div>';
  }

  function maxxWireSabiasQue(id) {
    var toggle = document.getElementById('maxx-sq-toggle-' + id);
    var zona = document.getElementById('maxx-sq-zona-' + id);
    var body = document.getElementById('maxx-sq-body-' + id);
    if (!toggle || !zona || !body) return;
    toggle.addEventListener('click', function() {
      body.style.display = body.style.display === 'none' ? 'block' : 'none';
    });
    zona.addEventListener('mouseleave', function() {
      body.style.display = 'none';
    });
  }

  function paint(panelId, unlocked) {
    var el = document.getElementById(panelId);
    el.className = 'maxx-panel ' + (unlocked ? 'maxx-unlocked' : 'maxx-locked');
  }

  // ---------- PANEL 1: Seccion I ----------
  function renderPanel1() {
    var el = document.getElementById('maxx-panel-1');
    el.innerHTML =
      '<div style="font-size:14px;color:#042C53;font-weight:700;margin-bottom:8px;letter-spacing:0.5px;">SECCIÓN I · TU LIBERTAD ECONÓMICA</div>' +
      '<div style="font-size:14px;font-weight:500;color:#3B6D11;margin-bottom:7px;line-height:1.25;">Imagina tu retiro: tranquilo, sin preocupaciones.<br>Dinos qué necesitas para lograrlo.</div>' +
      '<div style="display:flex;gap:8px;margin-bottom:8px;">' +
        '<div style="flex:1;"><div class="maxx-field-label" style="color:#042C53;">Edad actual</div>' +
          '<input class="maxx-input" type="number" id="maxx-edad" placeholder="Ej. 45" min="18" max="80"></div>' +
        '<div style="flex:1;"><div class="maxx-field-label" style="color:#042C53;">Género</div>' +
          '<div style="display:flex;gap:5px;">' +
            '<button type="button" id="maxx-genero-h" style="flex:1;padding:8px;border-radius:8px;border:1.5px solid #042C53;background:#042C53;color:#fff;font-size:12px;cursor:pointer;">H</button>' +
            '<button type="button" id="maxx-genero-m" style="flex:1;padding:8px;border-radius:8px;border:1.5px solid #D3D1C7;background:#fff;color:#5F5E5A;font-size:12px;cursor:pointer;">M</button>' +
          '</div></div>' +
      '</div>' +
      '<div style="margin-bottom:8px;">' +
        '<div class="maxx-field-label" style="color:#042C53;">¿A qué edad te retiras? <span id="maxx-retiro-out" style="color:#639922;">65 años</span></div>' +
        '<input type="range" id="maxx-retiro" min="60" max="75" value="65" step="1" style="width:100%;accent-color:#EF9F27;">' +
        '<div id="maxx-anios-restantes-out" style="font-size:11px;color:#042C53;font-weight:600;margin-top:4px;"></div>' +
        '<div id="maxx-retiro-warn" style="font-size:10px;color:#993C1D;margin-top:3px;display:none;"></div>' +
      '</div>' +
      '<div style="margin-bottom:7px;">' +
        '<div class="maxx-field-label" style="color:#042C53;">Monto mensual que necesitarías para vivir tranquilo en tu retiro <span style="font-weight:400;color:#5F5E5A;">(incluye a tu cónyuge/dependientes)</span></div>' +
        '<input class="maxx-input" type="text" id="maxx-monto-deseado" placeholder="$ 30,000">' +
      '</div>' +
      maxxSabiasQueHTML('esperanza', '¿Cuánto ha crecido la esperanza de vida en México?', 0);

    document.getElementById('maxx-genero-h').onclick = function() { maxxSetGenero('H'); };
    document.getElementById('maxx-genero-m').onclick = function() { maxxSetGenero('M'); };
    maxxWireSabiasQue('esperanza');
    document.getElementById('maxx-edad').addEventListener('input', function() {
      window.maxxData.edadActual = parseInt(this.value, 10) || 0;
      maxxCheckSeccion1();
    });
    var slider = document.getElementById('maxx-retiro');
    slider.addEventListener('input', function() {
      document.getElementById('maxx-retiro-out').textContent = this.value + ' años';
      window.maxxData.edadRetiro = parseInt(this.value, 10);
      maxxCheckSeccion1();
      maxxActualizarSabiasQueEsperanza();
    });
    window.maxxData.edadRetiro = window.maxxData.edadRetiro || 65;
    document.getElementById('maxx-monto-deseado').addEventListener('input', function() {
      var raw = this.value.replace(/[^0-9]/g, '');
      var num = parseInt(raw, 10) || 0;
      window.maxxData.montoDeseado = num;
      this.value = num ? ('$' + num.toLocaleString('es-MX')) : '';
      maxxCheckSeccion1();
    });
    window.maxxData.genero = window.maxxData.genero || 'H';
  }

  window.maxxSetGenero = function(g) {
    window.maxxData.genero = g;
    var h = document.getElementById('maxx-genero-h');
    var m = document.getElementById('maxx-genero-m');
    if (g === 'H') {
      h.style.background = '#042C53'; h.style.color = '#fff'; h.style.borderColor = '#042C53';
      m.style.background = '#fff'; m.style.color = '#5F5E5A'; m.style.borderColor = '#D3D1C7';
    } else {
      m.style.background = '#042C53'; m.style.color = '#fff'; m.style.borderColor = '#042C53';
      h.style.background = '#fff'; h.style.color = '#5F5E5A'; h.style.borderColor = '#D3D1C7';
    }
    maxxActualizarSabiasQueEsperanza();
    if (window.maxxData.seccion3Valida) { maxxRenderizarResultados(); }
  };

  window.maxxCheckSeccion1 = function() {
    var edad = window.maxxData.edadActual;
    var retiro = window.maxxData.edadRetiro;
    var monto = window.maxxData.montoDeseado;
    var warn = document.getElementById('maxx-retiro-warn');
    var aniosOut = document.getElementById('maxx-anios-restantes-out');
    var valido = true;
    var msg = '';

    if (retiro - (edad || 0) < 10 && edad) {
      msg = '⚠ Mínimo 10 años de plazo — ajusta tu edad de retiro.';
      valido = false;
    } else if (edad >= 60 && (retiro - edad) > 10) {
      msg = '⚠ Para 60+ años, el plazo máximo es 10 años.';
      valido = false;
    }
    if (warn) {
      warn.style.display = msg ? 'block' : 'none';
      warn.textContent = msg;
    }
    if (aniosOut) {
      if (edad > 0 && retiro > edad) {
        aniosOut.textContent = '📅 Te quedan ' + (retiro - edad) + ' años para ahorrar, a partir de este año.';
      } else {
        aniosOut.textContent = '';
      }
    }

    var completo = edad >= 18 && valido && monto > 0;
    window.maxxData.seccion1Valida = completo;
    paint('maxx-panel-2', completo);
    renderPanel2(completo);
    if (window.maxxData.seccion3Valida) { maxxRenderizarResultados(); }
  };

  // ---------- PANEL 2: Seccion II (Indicadores) ----------
  var MAXX_INFLACION_MIN = 0.04;
  var MAXX_TASA_MIN = 0.0882;
  window.maxxData.inflacion = window.maxxData.inflacion || 0.0485;
  window.maxxData.tasaSolucion = window.maxxData.tasaSolucion || 0.1482;

  function renderPanel2(unlocked) {
    var el = document.getElementById('maxx-panel-2');
    var lockIcon = unlocked ? '' : '🔒 ';
    var titleColor = unlocked ? '#042C53' : '#5F5E5A';

    if (!unlocked) {
      el.innerHTML =
        '<div style="font-size:14px;color:' + titleColor + ';font-weight:700;margin-bottom:8px;letter-spacing:0.5px;">' + lockIcon + 'SECCIÓN II · INDICADORES</div>' +
        '<div style="font-size:11px;color:#a8a69d;">Inflación, Tasa de la Solución propuesta por MAXX y Tasa Real</div>';
      return;
    }

    var real = ((1 + window.maxxData.tasaSolucion) / (1 + window.maxxData.inflacion) - 1);

    el.innerHTML =
      '<div style="font-size:14px;color:#042C53;font-weight:700;margin-bottom:8px;letter-spacing:0.5px;">SECCIÓN II · INDICADORES</div>' +
      '<div style="font-size:11px;color:#5F5E5A;margin-bottom:8px;line-height:1.3;">Estas tasas vienen de datos históricos públicos (INEGI, S&P 500). Puedes ajustarlas, con un piso conservador.</div>' +

      '<div style="margin-bottom:9px;">' +
        '<div style="font-size:12px;color:#042C53;font-weight:600;margin-bottom:4px;">Inflación anual <span id="maxx-inflacion-out" style="color:#639922;">' + (window.maxxData.inflacion*100).toFixed(2) + '%</span></div>' +
        '<input type="range" id="maxx-inflacion" min="4" max="12" step="0.05" value="' + (window.maxxData.inflacion*100) + '" style="width:100%;accent-color:#EF9F27;">' +
        '<div style="font-size:10px;color:#5F5E5A;margin-top:3px;">Piso: 4% (no se puede bajar más)</div>' +
        '<div id="maxx-zona-inflacion">' +
        '<button type="button" id="maxx-toggle-tabla-inflacion" style="border:none;background:transparent;color:#0563C1;font-size:11px;font-weight:600;cursor:pointer;padding:4px 0;text-decoration:underline;">Ver tabla histórica de inflación (1996-2025) →</button>' +
        '<div id="maxx-tabla-inflacion" style="display:none;max-height:180px;overflow-y:auto;background:#fff;border-radius:8px;padding:8px;margin-top:4px;font-size:10px;"></div>' +
        '</div>' +
        maxxSabiasQueHTML('inflacion', '¿Qué tan alta ha sido la inflación en México?', 8) +
      '</div>' +

      '<div style="margin-bottom:9px;">' +
        '<div style="font-size:12px;color:#042C53;font-weight:600;margin-bottom:4px;">Rendimiento — Solución propuesta por MAXX <span id="maxx-tasa-out" style="color:#639922;">' + (window.maxxData.tasaSolucion*100).toFixed(2) + '%</span></div>' +
        '<input type="range" id="maxx-tasa" min="8.82" max="20" step="0.05" value="' + (window.maxxData.tasaSolucion*100) + '" style="width:100%;accent-color:#EF9F27;">' +
        '<div style="font-size:10px;color:#5F5E5A;margin-top:3px;">Piso: 8.82% (mínimo histórico, 25 años)</div>' +
        '<div id="maxx-zona-sp">' +
        '<button type="button" id="maxx-toggle-tabla-sp" style="border:none;background:transparent;color:#0563C1;font-size:11px;font-weight:600;cursor:pointer;padding:4px 0;text-decoration:underline;">Ver tabla histórica S&P 500 (5-30 años) →</button>' +
        '<div id="maxx-tabla-sp" style="display:none;background:#fff;border-radius:8px;padding:8px;margin-top:4px;font-size:10px;"></div>' +
        '</div>' +
        maxxSabiasQueHTML('sp500', '¿El S&P 500 rinde lo que ves en la tabla?', 8) +
      '</div>' +

      '<div style="background:#fff;border-radius:8px;padding:10px;display:flex;justify-content:space-between;align-items:center;">' +
        '<span style="font-size:11px;color:#042C53;font-weight:600;">Tasa Real (ya sin inflación)</span>' +
        '<span id="maxx-real-out" style="font-size:14px;font-weight:700;color:#3B6D11;">' + (real*100).toFixed(2) + '%</span>' +
      '</div>';

    document.getElementById('maxx-inflacion').addEventListener('input', function() {
      window.maxxData.inflacion = parseFloat(this.value) / 100;
      document.getElementById('maxx-inflacion-out').textContent = parseFloat(this.value).toFixed(2) + '%';
      maxxActualizarTasaReal();
      if (document.getElementById('maxx-tabla-inflacion').style.display !== 'none') maxxPintarTablaInflacion();
      if (window.maxxData.seccion3Valida) { maxxRenderizarResultados(); }
    });
    document.getElementById('maxx-tasa').addEventListener('input', function() {
      window.maxxData.tasaSolucion = parseFloat(this.value) / 100;
      document.getElementById('maxx-tasa-out').textContent = parseFloat(this.value).toFixed(2) + '%';
      maxxActualizarTasaReal();
      if (document.getElementById('maxx-tabla-sp').style.display !== 'none') maxxPintarTablaSP();
      if (window.maxxData.seccion3Valida) { maxxRenderizarResultados(); }
    });

    document.getElementById('maxx-toggle-tabla-inflacion').addEventListener('click', function() {
      var div = document.getElementById('maxx-tabla-inflacion');
      var abrir = div.style.display === 'none';
      div.style.display = abrir ? 'block' : 'none';
      this.textContent = abrir ? 'Ocultar tabla de inflación ↑' : 'Ver tabla histórica de inflación (1996-2025) →';
      if (abrir) maxxPintarTablaInflacion();
    });
    document.getElementById('maxx-toggle-tabla-sp').addEventListener('click', function() {
      var div = document.getElementById('maxx-tabla-sp');
      var abrir = div.style.display === 'none';
      div.style.display = abrir ? 'block' : 'none';
      this.textContent = abrir ? 'Ocultar tabla S&P 500 ↑' : 'Ver tabla histórica S&P 500 (5-30 años) →';
      if (abrir) maxxPintarTablaSP();
    });

    // Auto-cerrar la tabla cuando el cursor sale de la zona (enlace + tabla)
    document.getElementById('maxx-zona-inflacion').addEventListener('mouseleave', function() {
      var div = document.getElementById('maxx-tabla-inflacion');
      div.style.display = 'none';
      document.getElementById('maxx-toggle-tabla-inflacion').textContent = 'Ver tabla histórica de inflación (1996-2025) →';
    });
    document.getElementById('maxx-zona-sp').addEventListener('mouseleave', function() {
      var div = document.getElementById('maxx-tabla-sp');
      div.style.display = 'none';
      document.getElementById('maxx-toggle-tabla-sp').textContent = 'Ver tabla histórica S&P 500 (5-30 años) →';
    });

    maxxWireSabiasQue('inflacion');
    maxxWireSabiasQue('sp500');

    // Seccion II siempre queda valida (tiene valores por default razonables) -> desbloquea Seccion III de una vez
    paint('maxx-panel-3', true);
    renderPanel3(true);
  }

  // ---------- Tabla histórica de inflación (INEGI/Banxico, 1996-2025, verificada en el MVP de Excel) ----------
  var MAXX_TABLA_INFLACION = [
    [1996,0.2770],[1997,0.1572],[1998,0.1861],[1999,0.1232],[2000,0.0896],
    [2001,0.0440],[2002,0.0570],[2003,0.0398],[2004,0.0519],[2005,0.0333],
    [2006,0.0405],[2007,0.0376],[2008,0.0653],[2009,0.0357],[2010,0.0440],
    [2011,0.0382],[2012,0.0357],[2013,0.0397],[2014,0.0408],[2015,0.0213],
    [2016,0.0336],[2017,0.0677],[2018,0.0483],[2019,0.0283],[2020,0.0315],
    [2021,0.0736],[2022,0.0782],[2023,0.0466],[2024,0.0421],[2025,0.0369]
  ];

  window.maxxPintarTablaInflacion = function() {
    var actual = window.maxxData.inflacion;
    var html = '<table style="width:100%;border-collapse:collapse;">' +
      '<tr style="font-weight:700;color:#042C53;"><td>Año</td><td style="text-align:right;">Inflación</td></tr>';
    MAXX_TABLA_INFLACION.forEach(function(row) {
      var esCercano = Math.abs(row[1] - actual) < 0.003;
      html += '<tr style="' + (esCercano ? 'background:#EAF3DE;font-weight:700;color:#3B6D11;' : 'color:#5F5E5A;') + '">' +
        '<td>' + row[0] + '</td><td style="text-align:right;">' + (row[1]*100).toFixed(2) + '%' + (esCercano ? ' ◄ cerca de tu valor' : '') + '</td></tr>';
    });
    html += '</table>' +
      '<div style="font-size:9px;color:#888780;margin-top:6px;">Fuente: INEGI/Banxico, boletines oficiales de INPC.</div>';
    document.getElementById('maxx-tabla-inflacion').innerHTML = html;
  };

  // ---------- Tabla histórica S&P 500 (5-30 años, verificada en el MVP de Excel) ----------
  var MAXX_TABLA_SP = [
    ['5 años', 0.1443, 0.0554], ['10 años', 0.1482, 0.0485], ['15 años', 0.1407, 0.0441],
    ['20 años', 0.1100, 0.0442], ['25 años', 0.0882, 0.0444], ['30 años', 0.1040, 0.0636]
  ];

  window.maxxPintarTablaSP = function() {
    var actual = window.maxxData.tasaSolucion;
    var html = '<table style="width:100%;border-collapse:collapse;">' +
      '<tr style="font-weight:700;color:#042C53;"><td>Periodo</td><td style="text-align:right;">Nominal</td><td style="text-align:right;">Real</td></tr>';
    MAXX_TABLA_SP.forEach(function(row) {
      var nominal = row[1], inflacionPeriodo = row[2];
      var real = ((1+nominal)/(1+inflacionPeriodo)-1);
      var esActual = Math.abs(nominal - actual) < 0.003;
      html += '<tr style="' + (esActual ? 'background:#EAF3DE;font-weight:700;color:#3B6D11;' : 'color:#5F5E5A;') + '">' +
        '<td>' + row[0] + '</td><td style="text-align:right;">' + (nominal*100).toFixed(2) + '%</td>' +
        '<td style="text-align:right;">' + (real*100).toFixed(2) + '%' + (esActual ? ' ◄ TASA ACTUAL' : '') + '</td></tr>';
    });
    html += '</table>' +
      '<div style="font-size:9px;color:#888780;margin-top:6px;">Fuente: Wikipedia S&P 500 (Annualized Return) + Fidelity. Cada renglón es lo que ganó alguien que invirtió HACE ese número de años — no es una proyección.</div>';
    document.getElementById('maxx-tabla-sp').innerHTML = html;
  };

  window.maxxActualizarTasaReal = function() {
    var real = ((1 + window.maxxData.tasaSolucion) / (1 + window.maxxData.inflacion) - 1);
    var out = document.getElementById('maxx-real-out');
    if (out) out.textContent = (real*100).toFixed(2) + '%';
  };

  // ---------- PANEL 3: Seccion III (Con que Cuentas) ----------
  window.maxxData.capacidadAhorro = window.maxxData.capacidadAhorro || 0;
  window.maxxData.tieneAfore = window.maxxData.tieneAfore || null;
  window.maxxData.ley73 = window.maxxData.ley73 || null;
  window.maxxData.aniosCotizando = window.maxxData.aniosCotizando || 0;
  window.maxxData.sueldoBruto = window.maxxData.sueldoBruto || 0;
  window.maxxData.ingresoActual = window.maxxData.ingresoActual || 0;
  window.maxxData.conyugeApoya = window.maxxData.conyugeApoya || null;
  window.maxxData.conyugeAfore = window.maxxData.conyugeAfore || null;
  window.maxxData.conyugeLey73 = window.maxxData.conyugeLey73 || null;
  window.maxxData.conyugeAnios = window.maxxData.conyugeAnios || 0;
  window.maxxData.conyugeSueldo = window.maxxData.conyugeSueldo || 0;
  window.maxxData.conyugeIngreso = window.maxxData.conyugeIngreso || 0;
  window.maxxData.tieneAhorros = window.maxxData.tieneAhorros || null;
  window.maxxData.montoAhorros = window.maxxData.montoAhorros || 0;
  window.maxxData.casaPropia = window.maxxData.casaPropia || null;
  window.maxxData.valorCasa = window.maxxData.valorCasa || 0;
  window.maxxData.otraFuente = window.maxxData.otraFuente || null;
  window.maxxData.montoOtraFuente = window.maxxData.montoOtraFuente || 0;

  function maxxPill(name, value, current, label) {
    var activo = current === value;
    return '<button type="button" data-pill="' + name + '" data-val="' + value + '" style="flex:1;padding:8px;border-radius:8px;border:1.5px solid ' + (activo ? '#042C53' : '#D3D1C7') + ';background:' + (activo ? '#042C53' : '#fff') + ';color:' + (activo ? '#fff' : '#5F5E5A') + ';font-size:12px;font-weight:600;cursor:pointer;">' + label + '</button>';
  }

  function renderPanel3(unlocked) {
    var el = document.getElementById('maxx-panel-3');
    var lockIcon = unlocked ? '' : '🔒 ';
    var titleColor = unlocked ? '#042C53' : '#5F5E5A';

    if (!unlocked) {
      el.innerHTML = '<div style="font-size:14px;color:' + titleColor + ';font-weight:700;letter-spacing:0.5px;">' + lockIcon + 'SECCIÓN III · CON QUÉ CUENTAS</div>';
      return;
    }

    var d = window.maxxData;

    // Pre-calculo rapido de en que paso vamos, para el contador de progreso
    var plazoPre = (d.edadRetiro || 65) - (d.edadActual || 0);
    var minimoPre = plazoPre <= 10 ? 3000 : 2000;
    var pasoActual = 1;
    var p1 = d.capacidadAhorro >= minimoPre;
    if (p1) pasoActual = 2;
    var p2 = p1 && d.tieneAfore && (d.tieneAfore === 'N' ? d.ingresoActual > 0 : (d.aniosCotizando > 0 && d.sueldoBruto > 0 && !!d.ley73));
    if (p2) pasoActual = 3;
    var p3 = p2 && (d.conyugeApoya === 'N' || (d.conyugeApoya === 'S' && d.conyugeEdadActual > 0 && d.conyugeAfore && (d.conyugeAfore === 'N' ? d.conyugeIngreso > 0 : (d.conyugeAnios > 0 && d.conyugeSueldo > 0 && !!d.conyugeLey73))));
    if (p3) pasoActual = 4;
    var p4 = p3 && (d.tieneAhorros === 'N' || (d.tieneAhorros === 'S' && d.montoAhorros > 0));
    if (p4) pasoActual = 5;
    var p5 = p4 && (d.casaPropia === 'S' || d.casaPropia === 'N');
    if (p5) pasoActual = 6;
    var p6 = p5 && (d.otraFuente === 'S' || d.otraFuente === 'N');
    if (p6) pasoActual = 6;

    var html = '<div style="font-size:14px;color:#042C53;font-weight:700;margin-bottom:4px;letter-spacing:0.5px;">SECCIÓN III · CON QUÉ CUENTAS</div>' +
      '<div style="font-size:14px;font-weight:500;color:#3B6D11;margin-bottom:8px;line-height:1.25;">Solo cuenta lo que ya tienes hoy — nada de ingresos futuros inciertos.</div>' +
      '<div style="display:flex;gap:4px;margin-bottom:4px;">' +
        [1,2,3,4,5,6].map(function(n) { return '<div style="flex:1;height:6px;border-radius:3px;background:' + (n <= pasoActual ? '#042C53' : '#D3D1C7') + ';"></div>'; }).join('') +
      '</div>' +
      '<div style="font-size:10px;color:#5F5E5A;margin-bottom:9px;">Pregunta ' + pasoActual + ' de 6' + (p6 ? ' · ¡completo!' : '') + '</div>';

    // Capacidad de ahorro — SIEMPRE visible, es la primera pregunta
    var plazo = (d.edadRetiro || 65) - (d.edadActual || 0);
    var minimoAportacion = plazo <= 10 ? 3000 : 2000;
    html += '<div style="margin-bottom:7px;">' +
      '<div style="font-size:12px;color:#042C53;font-weight:600;margin-bottom:4px;">Capacidad de ahorro mensual</div>' +
      '<input type="text" id="maxx-capacidad" placeholder="$ 5,000" value="' + (d.capacidadAhorro ? '$'+d.capacidadAhorro.toLocaleString('es-MX') : '') + '" style="width:100%;padding:8px 10px;border-radius:8px;border:1px solid #D3D1C7;font-size:13px;box-sizing:border-box;">' +
      '<div id="maxx-capacidad-warn" style="font-size:10px;color:#993C1D;margin-top:4px;display:none;"></div>' +
      '<div style="font-size:10px;color:#5F5E5A;margin-top:4px;">Mínimo $' + minimoAportacion.toLocaleString('es-MX') + '/mes para tu plazo de ' + plazo + ' años.</div>' +
      '</div>';
    var paso1Completo = d.capacidadAhorro >= minimoAportacion;

    // AFORE — solo aparece si ya se lleno la capacidad de ahorro
    var paso2Completo = false;
    if (paso1Completo) {
      html += '<div style="margin-bottom:9px;">' +
        '<div style="font-size:12px;color:#042C53;font-weight:600;margin-bottom:4px;">¿Tienes AFORE?</div>' +
        '<div style="display:flex;gap:8px;">' + maxxPill('tieneAfore','S',d.tieneAfore,'Sí') + maxxPill('tieneAfore','N',d.tieneAfore,'No') + '</div>';
      if (d.tieneAfore === 'S') {
        html += '<div style="margin-top:6px;display:flex;gap:8px;">' +
          '<div style="flex:1;"><div style="font-size:10px;color:#5F5E5A;margin-bottom:4px;">Años cotizando</div>' +
          '<input type="number" id="maxx-anios-cot" min="0" placeholder="Ej. 12" value="' + (d.aniosCotizando || '') + '" style="width:100%;padding:7px;border-radius:6px;border:1px solid #D3D1C7;font-size:12px;box-sizing:border-box;"></div>' +
          '<div style="flex:1;"><div style="font-size:10px;color:#5F5E5A;margin-bottom:4px;">Sueldo BRUTO mensual</div>' +
          '<input type="text" id="maxx-sueldo-bruto" placeholder="$ 20,000" value="' + (d.sueldoBruto ? '$'+d.sueldoBruto.toLocaleString('es-MX') : '') + '" style="width:100%;padding:7px;border-radius:6px;border:1px solid #D3D1C7;font-size:12px;box-sizing:border-box;"></div>' +
          '</div>' +
          '<div style="margin-top:6px;">' +
          '<div style="font-size:10px;color:#5F5E5A;margin-bottom:4px;">¿Cotizaste por primera vez antes de julio 1997?</div>' +
          '<div style="display:flex;gap:8px;">' + maxxPill('ley73','S',d.ley73,'Sí (Ley 73)') + maxxPill('ley73','N',d.ley73,'No (Ley 97)') + '</div>' +
          '</div>';
        paso2Completo = d.aniosCotizando > 0 && d.sueldoBruto > 0 && !!d.ley73;
      } else if (d.tieneAfore === 'N') {
        html += '<div style="margin-top:6px;">' +
          '<div style="font-size:10px;color:#5F5E5A;margin-bottom:4px;">Ingreso actual libre de impuestos</div>' +
          '<input type="text" id="maxx-ingreso-actual" placeholder="$ 15,000" value="' + (d.ingresoActual ? '$'+d.ingresoActual.toLocaleString('es-MX') : '') + '" style="width:100%;padding:7px;border-radius:6px;border:1px solid #D3D1C7;font-size:12px;box-sizing:border-box;"></div>';
        paso2Completo = d.ingresoActual > 0;
      }
      html += '</div>';
    }

    // Conyuge — solo aparece si AFORE ya quedo completo
    var paso3Completo = false;
    if (paso2Completo) {
      html += '<div style="margin-bottom:9px;">' +
        '<div style="font-size:12px;color:#042C53;font-weight:600;margin-bottom:4px;">¿Tu cónyuge apoya a cubrir el retiro?</div>' +
        '<div style="display:flex;gap:8px;">' + maxxPill('conyugeApoya','S',d.conyugeApoya,'Sí') + maxxPill('conyugeApoya','N',d.conyugeApoya,'No') + '</div>';
      if (d.conyugeApoya === 'S') {
        html += '<div style="margin-top:6px;"><div style="font-size:10px;color:#5F5E5A;margin-bottom:4px;">Edad actual del cónyuge</div>' +
          '<input type="number" id="maxx-conyuge-edad" min="18" max="90" placeholder="Ej. 43" value="' + (d.conyugeEdadActual || '') + '" style="width:100%;padding:7px;border-radius:6px;border:1px solid #D3D1C7;font-size:12px;box-sizing:border-box;"></div>';
        if (d.conyugeEdadActual > 0) {
          html += '<div style="margin-top:6px;">' +
            '<div style="font-size:10px;color:#5F5E5A;margin-bottom:4px;">¿Tu cónyuge tiene AFORE?</div>' +
            '<div style="display:flex;gap:8px;">' + maxxPill('conyugeAfore','S',d.conyugeAfore,'Sí') + maxxPill('conyugeAfore','N',d.conyugeAfore,'No') + '</div></div>';
          if (d.conyugeAfore === 'S') {
            html += '<div style="margin-top:6px;display:flex;gap:8px;">' +
              '<div style="flex:1;"><div style="font-size:10px;color:#5F5E5A;margin-bottom:4px;">Años cotizando (cónyuge)</div>' +
              '<input type="number" id="maxx-conyuge-anios" min="0" placeholder="Ej. 10" value="' + (d.conyugeAnios || '') + '" style="width:100%;padding:7px;border-radius:6px;border:1px solid #D3D1C7;font-size:12px;box-sizing:border-box;"></div>' +
              '<div style="flex:1;"><div style="font-size:10px;color:#5F5E5A;margin-bottom:4px;">Sueldo BRUTO (cónyuge)</div>' +
              '<input type="text" id="maxx-conyuge-sueldo" placeholder="$ 18,000" value="' + (d.conyugeSueldo ? '$'+d.conyugeSueldo.toLocaleString('es-MX') : '') + '" style="width:100%;padding:7px;border-radius:6px;border:1px solid #D3D1C7;font-size:12px;box-sizing:border-box;"></div>' +
              '</div>' +
              '<div style="margin-top:6px;">' +
              '<div style="font-size:10px;color:#5F5E5A;margin-bottom:4px;">¿Cotizó antes de julio 1997?</div>' +
              '<div style="display:flex;gap:8px;">' + maxxPill('conyugeLey73','S',d.conyugeLey73,'Sí (Ley 73)') + maxxPill('conyugeLey73','N',d.conyugeLey73,'No (Ley 97)') + '</div></div>';
            paso3Completo = d.conyugeAnios > 0 && d.conyugeSueldo > 0 && !!d.conyugeLey73;
          } else if (d.conyugeAfore === 'N') {
            html += '<div style="margin-top:6px;"><div style="font-size:10px;color:#5F5E5A;margin-bottom:4px;">Ingreso actual del cónyuge</div>' +
              '<input type="text" id="maxx-conyuge-ingreso" placeholder="$ 12,000" value="' + (d.conyugeIngreso ? '$'+d.conyugeIngreso.toLocaleString('es-MX') : '') + '" style="width:100%;padding:7px;border-radius:6px;border:1px solid #D3D1C7;font-size:12px;box-sizing:border-box;"></div>';
            paso3Completo = d.conyugeIngreso > 0;
          }
        }
      } else if (d.conyugeApoya === 'N') {
        paso3Completo = true;
      }
      html += '</div>';
    }

    // Ahorros — solo aparece si conyuge ya quedo completo
    var paso4Completo = false;
    if (paso3Completo) {
      html += '<div style="margin-bottom:9px;">' +
        '<div style="font-size:12px;color:#042C53;font-weight:600;margin-bottom:4px;">¿Tienes ahorros que planeas MANTENER hasta tu retiro?</div>' +
        '<div style="display:flex;gap:8px;">' + maxxPill('tieneAhorros','S',d.tieneAhorros,'Sí') + maxxPill('tieneAhorros','N',d.tieneAhorros,'No') + '</div>';
      if (d.tieneAhorros === 'S') {
        html += '<div style="margin-top:6px;"><div style="font-size:10px;color:#5F5E5A;margin-bottom:4px;">Monto actual</div>' +
          '<input type="text" id="maxx-monto-ahorros" placeholder="$ 100,000" value="' + (d.montoAhorros ? '$'+d.montoAhorros.toLocaleString('es-MX') : '') + '" style="width:100%;padding:7px;border-radius:6px;border:1px solid #D3D1C7;font-size:12px;box-sizing:border-box;"></div>';
        paso4Completo = d.montoAhorros > 0;
      } else if (d.tieneAhorros === 'N') {
        paso4Completo = true;
      }
      html += '</div>';
    }

    // Casa propia — solo aparece si ahorros ya quedo completo
    var paso5Completo = false;
    if (paso4Completo) {
      html += '<div style="margin-bottom:9px;">' +
        '<div style="font-size:12px;color:#042C53;font-weight:600;margin-bottom:4px;">¿Tienes casa propia? <span style="font-weight:400;color:#a8a69d;">(informativo)</span></div>' +
        '<div style="display:flex;gap:8px;">' + maxxPill('casaPropia','S',d.casaPropia,'Sí') + maxxPill('casaPropia','N',d.casaPropia,'No') + '</div>';
      if (d.casaPropia === 'S') {
        html += '<div style="margin-top:6px;"><div style="font-size:10px;color:#5F5E5A;margin-bottom:4px;">Valor estimado</div>' +
          '<input type="text" id="maxx-valor-casa" placeholder="$ 2,000,000" value="' + (d.valorCasa ? '$'+d.valorCasa.toLocaleString('es-MX') : '') + '" style="width:100%;padding:7px;border-radius:6px;border:1px solid #D3D1C7;font-size:12px;box-sizing:border-box;"></div>';
      }
      html += '</div>';
      paso5Completo = d.casaPropia === 'S' || d.casaPropia === 'N';
    }

    // Otra fuente — solo aparece si casa propia ya se contesto
    if (paso5Completo) {
      html += '<div>' +
        '<div style="font-size:12px;color:#042C53;font-weight:600;margin-bottom:4px;">¿Tienes otra fuente de ingreso? <span style="font-weight:400;color:#a8a69d;">(informativo)</span></div>' +
        '<div style="display:flex;gap:8px;">' + maxxPill('otraFuente','S',d.otraFuente,'Sí') + maxxPill('otraFuente','N',d.otraFuente,'No') + '</div>';
      if (d.otraFuente === 'S') {
        html += '<div style="margin-top:6px;"><div style="font-size:10px;color:#5F5E5A;margin-bottom:4px;">Monto mensual equivalente</div>' +
          '<input type="text" id="maxx-monto-otra" placeholder="$ 3,000" value="' + (d.montoOtraFuente ? '$'+d.montoOtraFuente.toLocaleString('es-MX') : '') + '" style="width:100%;padding:7px;border-radius:6px;border:1px solid #D3D1C7;font-size:12px;box-sizing:border-box;"></div>';
      }
      html += '</div>';
    }

    // Senal visual de que sigue algo mas, mientras no se haya completado todo
    if (!p6) {
      html += '<div style="margin-top:9px;padding:10px;border-radius:8px;border:1.5px dashed #D3D1C7;color:#a8a69d;font-size:11px;text-align:center;"><span style="font-size:20px;vertical-align:middle;">👆</span><br>Contesta arriba para ver la siguiente pregunta</div>';
    }

    // Sabías que: crecimiento salarial real lento
    html += maxxSabiasQueHTML('salario', '¿Cuánto ha crecido el salario real en México?', 12);

    // Sabías que condicional: semanas insuficientes
    if (d.tieneAfore === 'S' && d.aniosCotizando > 0 && (d.aniosCotizando * 54) < 875) {
      html += maxxSabiasQueHTML('semanas', '¿Qué pasa si no completas tus semanas del IMSS?', 6);
    }

    el.innerHTML = html;
    maxxWireSeccion3();
    maxxWireSabiasQue('salario');
    if (d.tieneAfore === 'S' && d.aniosCotizando > 0 && (d.aniosCotizando * 54) < 875) {
      maxxWireSabiasQue('semanas');
    }
  }

  function maxxMoneyField(id, dataKey) {
    var input = document.getElementById(id);
    if (!input) return;
    input.addEventListener('input', function() {
      var digits = this.value.replace(/[^0-9]/g, '');
      var num = parseInt(digits, 10) || 0;
      window.maxxData[dataKey] = num;
      this.value = num ? ('$' + num.toLocaleString('es-MX')) : '';
      maxxCheckSeccion3();
    });
    input.addEventListener('blur', function() { renderPanel3(true); });
  }

  function maxxWireSeccion3() {
    var el = document.getElementById('maxx-panel-3');

    var capacidad = document.getElementById('maxx-capacidad');
    if (capacidad) capacidad.addEventListener('input', function() {
      var digits = this.value.replace(/[^0-9]/g, '');
      var num = parseInt(digits, 10) || 0;
      window.maxxData.capacidadAhorro = num;
      this.value = num ? ('$' + num.toLocaleString('es-MX')) : '';
      var plazo = (window.maxxData.edadRetiro || 65) - (window.maxxData.edadActual || 0);
      var minimo = plazo <= 10 ? 3000 : 2000;
      var warnEl = document.getElementById('maxx-capacidad-warn');
      if (num > 0 && num < minimo) {
        warnEl.style.display = 'block';
        warnEl.textContent = '⚠ El mínimo para un plazo de ' + plazo + ' años es $' + minimo.toLocaleString('es-MX') + '/mes.';
      } else {
        warnEl.style.display = 'none';
      }
      maxxCheckSeccion3();
    });
    capacidad.addEventListener('blur', function() { renderPanel3(true); });

    el.querySelectorAll('[data-pill]').forEach(function(btn) {
      btn.addEventListener('click', function() {
        var name = this.getAttribute('data-pill');
        var val = this.getAttribute('data-val');
        window.maxxData[name] = val;
        renderPanel3(true);
      });
    });

    var anios = document.getElementById('maxx-anios-cot');
    if (anios) anios.addEventListener('input', function() {
      window.maxxData.aniosCotizando = parseInt(this.value, 10) || 0;
      maxxCheckSeccion3();
    });
    if (anios) anios.addEventListener('blur', function() { renderPanel3(true); });
    var conyugeAnios = document.getElementById('maxx-conyuge-anios');
    if (conyugeAnios) conyugeAnios.addEventListener('input', function() {
      window.maxxData.conyugeAnios = parseInt(this.value, 10) || 0;
      maxxCheckSeccion3();
    });
    if (conyugeAnios) conyugeAnios.addEventListener('blur', function() { renderPanel3(true); });
    var conyugeEdad = document.getElementById('maxx-conyuge-edad');
    if (conyugeEdad) conyugeEdad.addEventListener('input', function() {
      window.maxxData.conyugeEdadActual = parseInt(this.value, 10) || 0;
      maxxCheckSeccion3();
    });
    if (conyugeEdad) conyugeEdad.addEventListener('blur', function() { renderPanel3(true); });

    maxxMoneyField('maxx-sueldo-bruto', 'sueldoBruto');
    maxxMoneyField('maxx-ingreso-actual', 'ingresoActual');
    maxxMoneyField('maxx-conyuge-sueldo', 'conyugeSueldo');
    maxxMoneyField('maxx-conyuge-ingreso', 'conyugeIngreso');
    maxxMoneyField('maxx-monto-ahorros', 'montoAhorros');
    maxxMoneyField('maxx-valor-casa', 'valorCasa');
    maxxMoneyField('maxx-monto-otra', 'montoOtraFuente');

    maxxCheckSeccion3();
  }

  window.maxxCheckSeccion3 = function() {
    var d = window.maxxData;
    var plazo = (d.edadRetiro || 65) - (d.edadActual || 0);
    var minimoAportacion = plazo <= 10 ? 3000 : 2000;
    var completo = d.capacidadAhorro >= minimoAportacion && d.tieneAfore &&
      (d.tieneAfore === 'N' ? d.ingresoActual > 0 : (d.aniosCotizando > 0 && d.sueldoBruto > 0 && d.ley73)) &&
      d.conyugeApoya &&
      (d.conyugeApoya === 'N' || (d.conyugeEdadActual > 0 && d.conyugeAfore && (d.conyugeAfore === 'N' ? d.conyugeIngreso > 0 : (d.conyugeAnios > 0 && d.conyugeSueldo > 0 && d.conyugeLey73)))) &&
      d.tieneAhorros && (d.tieneAhorros === 'N' || d.montoAhorros > 0) &&
      d.casaPropia !== null &&
      d.otraFuente !== null;
    window.maxxData.seccion3Valida = completo;
    paint('maxx-panel-grafica', completo);
    paint('maxx-panel-4', completo);
    paint('maxx-panel-5', completo);
    paint('maxx-panel-califn1', completo);
    paint('maxx-panel-califn2', completo);
    paint('maxx-panel-cta', completo);
    if (completo) {
      maxxRenderizarResultados();
    } else {
      renderPlaceholder('maxx-panel-grafica', 'GRÁFICA · ACUMULACIÓN Y DESACUMULACIÓN');
      renderPlaceholder('maxx-panel-4', 'SECCIÓN IV · CÓMO LEER TU GRÁFICA');
      renderPlaceholder('maxx-panel-5', 'SECCIÓN V · RESULTADOS');
      renderPlaceholder('maxx-panel-califn1', 'SIN Solución propuesta de MAXX');
      renderPlaceholder('maxx-panel-califn2', 'CON TU Propuesta de Aportaciones');
      renderPlaceholder('maxx-panel-cta', 'AGENDA TU CITA');
    }
  };

  function maxxRenderizarResultados() {
    var d = window.maxxData;
    var r = maxxCorrerMotor(d, {});
    window.maxxUltimoResultado = r;

    // ---- Grafica ----
    var edadEsperanzaVida = r.edadRetiro + r.esperanzaVida;
    var svg = maxxGenerarSVGGrafica(r.filas, {
      ancho: 1000, alto: 460, edadMaxima: 90,
      edadEsperanzaVida: edadEsperanzaVida, edadRetiro: r.edadRetiro
    });
    document.getElementById('maxx-panel-grafica').innerHTML =
      '<div style="font-size:13px;color:#042C53;font-weight:700;margin-bottom:4px;letter-spacing:0.5px;">GRÁFICA · ACUMULACIÓN Y DESACUMULACIÓN</div>' +
      '<div class="maxx-gira-pantalla" style="background:#FCEBD9;border-radius:8px;padding:8px 10px;margin-bottom:8px;font-size:11px;color:#993C1D;text-align:center;">📱↻ Gira tu pantalla para ver la gráfica más grande</div>' +
      svg +
      '<div style="display:flex;flex-wrap:wrap;justify-content:center;column-gap:22px;row-gap:4px;margin-top:6px;">' + maxxGenerarLeyendaHTML() + '</div>';

    // ---- Calificaciones ----
    var mensajeSin = 'Este es tu punto de partida. Vamos a mejorarlo.';
    document.getElementById('maxx-panel-califn1').innerHTML =
      '<div style="text-align:center;">' +
        '<div style="font-size:14px;color:#5F5E5A;font-weight:700;margin-bottom:8px;">SIN Solución propuesta de MAXX</div>' +
        '<div style="font-size:52px;font-weight:800;color:#042C53;line-height:1;">' + r.califSin + '<span style="font-size:20px;">/100</span></div>' +
        '<div style="font-size:15px;color:#993C1D;font-weight:700;margin-top:5px;">Tu GAP: ' + (100 - r.califSin) + '%</div>' +
        '<div style="font-size:14px;color:#042C53;font-weight:600;margin-top:6px;line-height:1.45;">' + mensajeSin + '</div>' +
      '</div>';

    var mensajeCon = r.califCon >= 100
      ? 'Con TUS Aportaciones podrás cerrar la brecha — en tu Cita, MAXX te dirá cómo contratar TU Plan y aprovechar todos sus beneficios.'
      : 'Con TUS Aportaciones cierras una parte de la brecha — en tu Cita MAXX te ayudará a cerrar el resto.';
    document.getElementById('maxx-panel-califn2').innerHTML =
      '<div style="text-align:center;">' +
        '<div style="font-size:14px;color:#5F5E5A;font-weight:700;margin-bottom:8px;">CON TU Propuesta de Aportaciones</div>' +
        '<div style="font-size:52px;font-weight:800;color:#3B6D11;line-height:1;">' + r.califCon + '<span style="font-size:20px;">/100</span></div>' +
        '<div style="font-size:15px;color:#993C1D;font-weight:700;margin-top:5px;">Tu GAP: ' + (100 - r.califCon) + '%</div>' +
        '<div style="font-size:14px;color:#3B6D11;font-weight:700;margin-top:6px;line-height:1.45;">' + mensajeCon + '</div>' +
      '</div>';

    // ---- Resultados (Seccion IV) ----
    var tasaNominalPct = d.tasaSolucion * 100;
    // Fondo REAL acumulado justo al momento del retiro (donde arranca la linea verde en la grafica) — no un derivado
    var fondoAlRetiro = 0;
    r.filas.forEach(function(f) {
      if (f.fase === 'Retiro' && f.capitalCombinado !== null && fondoAlRetiro === 0) fondoAlRetiro = f.capitalCombinado;
    });
    // Edad real donde el capital se agota, tomada de la MISMA simulacion que dibuja la grafica (nunca se contradicen)
    var edadCapitalAgotado = null;
    r.filas.forEach(function(f) {
      if (f.fase === 'Retiro' && f.capitalCombinado !== null) edadCapitalAgotado = f.edad;
    });
    var textoCobertura = edadCapitalAgotado !== null
      ? 'hasta los ' + edadCapitalAgotado + ' años de edad'
      : 'durante toda tu esperanza de vida';
    document.getElementById('maxx-panel-5').innerHTML =
      '<div style="font-size:14px;color:#042C53;font-weight:700;margin-bottom:8px;letter-spacing:0.5px;">SECCIÓN V · RESULTADOS</div>' +
      '<div style="font-size:11px;color:#5F5E5A;margin-bottom:7px;">Pesos nominales, suma de todos tus años de retiro.</div>' +
      '<div style="display:flex;justify-content:space-between;margin-bottom:4px;"><span style="font-size:12px;color:#5F5E5A;">Necesidad total</span><span style="font-size:12px;font-weight:700;color:#042C53;">$' + Math.round(r.necesidadTotal).toLocaleString('es-MX') + '</span></div>' +
      '<div style="display:flex;justify-content:space-between;margin-bottom:4px;"><span style="font-size:12px;color:#5F5E5A;">Tu pensión IMSS/AFORE cubre</span><span style="font-size:12px;font-weight:700;color:#042C53;">$' + Math.round(r.pensionFondeada).toLocaleString('es-MX') + '</span></div>' +
      '<div style="display:flex;justify-content:space-between;margin-bottom:7px;"><span style="font-size:12px;color:#5F5E5A;">Tu ahorro actual cubre</span><span style="font-size:12px;font-weight:700;color:#042C53;">$' + Math.round(r.ahorroFondeado).toLocaleString('es-MX') + '</span></div>' +
      '<div style="background:#EAF3DE;border-radius:8px;padding:10px;text-align:center;">' +
        '<div style="font-size:12px;color:#3B6D11;font-weight:700;margin-bottom:4px;">🎉 Esto es lo que se estima que tus aportaciones acumularán para tu retiro a los ' + r.edadRetiro + ' años de edad</div>' +
        '<div style="font-size:22px;font-weight:800;color:#3B6D11;line-height:1.1;">$' + Math.round(fondoAlRetiro).toLocaleString('es-MX') + '</div>' +
        '<div style="font-size:10px;font-weight:400;color:#5F8A3A;margin-top:1px;">(incluye inflación)</div>' +
        '<div style="font-size:11px;color:#3B6D11;font-weight:600;margin-top:5px;line-height:1.35;">Lo logras aportando $' + Math.round(d.capacidadAhorro).toLocaleString('es-MX') + '/mes, invertido a una tasa nominal de ' + tasaNominalPct.toFixed(2) + '% anual. <span style="font-weight:400;">(estimado con S&P500)</span><br>Al seguir invirtiendo tu saldo, te alcanzará para tener el equivalente a $' + Math.round(d.montoDeseado).toLocaleString('es-MX') + '/mes de hoy, ' + textoCobertura + '.</div>' +
        '<div style="font-size:13px;color:#3B6D11;font-weight:700;margin-top:7px;">MAXX te puede ayudar a lograr más.<br><strong>Agenda TU Cita.</strong></div>' +
      '</div>';

    // ---- Seccion V: Como leer tu grafica ----
    document.getElementById('maxx-panel-4').innerHTML =
      '<div style="font-size:14px;color:#042C53;font-weight:700;margin-bottom:8px;letter-spacing:0.5px;">SECCIÓN IV · CÓMO LEER TU GRÁFICA</div>' +
      '<div style="font-size:13px;color:#3D3B36;line-height:1.4;">' +
        '<strong style="color:#042C53;">①</strong> <strong style="color:#042C53;">Azul</strong> y <strong style="color:#EF9F27;">naranja</strong>: tu dinero creciendo mes a mes, hasta tu retiro.<br>' +
        '<strong style="color:#042C53;">②</strong> Al llegar a tu retiro, se SUMAN y nace la línea <strong style="color:#639922;">verde</strong>.<br>' +
        '<strong style="color:#042C53;">③</strong> La <strong style="color:#639922;">verde</strong> solo BAJA — cada mes se usa un poco para completar lo que tu pensión no alcanza.<br>' +
        '<strong style="color:#042C53;">④</strong> La línea vertical <strong style="color:#993C1D;">roja</strong> marca tu esperanza de vida; la <strong style="color:#042C53;">azul marino</strong>, tu edad de retiro.<br>' +
        '<strong style="color:#042C53;">⑤</strong> Si la <strong style="color:#639922;">verde</strong> llega a $0 antes de tu esperanza de vida, tu capital se agotó — de ahí en adelante vives solo de tu pensión (o sin ingreso, si no tienes).' +
      '</div>';

    // ---- CTA ----
    var aniosSorpresa = [5, 10, 15, 20, 25, 30];
    var filasSorpresa = aniosSorpresa.map(function(a) {
      var valorHoy = d.capacidadAhorro / Math.pow(1 + d.inflacion, a);
      return '<tr><td style="padding:5px 6px;color:#5F5E5A;font-size:13px;border-top:1px solid #E6E4DA;">' + a + '</td>' +
        '<td style="padding:5px 6px;text-align:center;color:#5F5E5A;font-size:13px;border-top:1px solid #E6E4DA;">$' + Math.round(d.capacidadAhorro).toLocaleString('es-MX') + '</td>' +
        '<td style="padding:5px 6px;text-align:right;font-weight:800;color:#042C53;font-size:13px;border-top:1px solid #E6E4DA;">$' + Math.round(valorHoy).toLocaleString('es-MX') + '</td></tr>';
    }).join('');

    document.getElementById('maxx-panel-cta').innerHTML =
      '<div id="maxx-zona-sorpresa" style="margin-bottom:10px;">' +
        '<button type="button" id="maxx-toggle-sorpresa" style="width:100%;display:flex;align-items:center;gap:12px;text-align:left;border:2px solid #042C53;background:#E8EEF4;border-radius:10px;padding:12px 14px;cursor:pointer;">' +
          '<span style="font-size:34px;line-height:1;">🔷</span>' +
          '<span style="font-size:15px;font-weight:800;color:#042C53;line-height:1.3;">Tengo una <u>sorpresa</u> que te va a encantar... →</span>' +
        '</button>' +
        '<div id="maxx-cuerpo-sorpresa" style="display:none;background:#fff;border-radius:8px;padding:12px;margin-top:6px;">' +
          '<div style="font-size:12px;color:#3D3B36;line-height:1.4;margin-bottom:8px;">Tu aportación de <strong>$' + Math.round(d.capacidadAhorro).toLocaleString('es-MX') + '/mes se queda FIJA</strong> — nunca la subes. Como tu sueldo normalmente sí sube con la inflación, con el tiempo te va a doler cada vez menos pagarla:</div>' +
          '<table style="width:100%;border-collapse:collapse;">' +
            '<tr><th style="padding:4px 6px;text-align:left;font-size:11px;color:#5F5E5A;">Año</th><th style="padding:4px 6px;text-align:center;font-size:11px;color:#5F5E5A;">Seguirás pagando</th><th style="padding:4px 6px;text-align:right;font-size:11px;color:#5F5E5A;">Pesará como (hoy)</th></tr>' +
            filasSorpresa +
          '</table>' +
        '</div>' +
      '</div>' +
      '<a href="https://meetings.hubspot.com/javier-rowe-hoppenstedt?utm_source=cuestionario&utm_medium=maxx_web&utm_campaign=calificacion" target="_blank" style="display:block;width:100%;padding:14px;border-radius:10px;border:none;background:#639922;color:#fff;font-size:15px;font-weight:800;cursor:pointer;line-height:1.4;text-align:center;text-decoration:none;box-sizing:border-box;">¿Quieres conocer la Solución Ideal para TI?<br><span style="font-size:18px;">Agenda TU Cita →</span><br><span style="font-size:12px;font-weight:600;">Gratuita. Sin Compromiso.</span></a>';

    document.getElementById('maxx-toggle-sorpresa').addEventListener('click', function() {
      var cuerpo = document.getElementById('maxx-cuerpo-sorpresa');
      cuerpo.style.display = cuerpo.style.display === 'none' ? 'block' : 'none';
    });
    document.getElementById('maxx-zona-sorpresa').addEventListener('mouseleave', function() {
      document.getElementById('maxx-cuerpo-sorpresa').style.display = 'none';
    });
  }

  // ---------- Placeholders bloqueados (se construyen despues) ----------
  function renderPlaceholder(panelId, titulo) {
    var el = document.getElementById(panelId);
    el.innerHTML = '<div style="font-size:14px;color:#5F5E5A;font-weight:700;letter-spacing:0.5px;">🔒 ' + titulo + '</div>';
  }
  renderPlaceholder('maxx-panel-grafica', 'GRÁFICA · ACUMULACIÓN Y DESACUMULACIÓN');
  renderPlaceholder('maxx-panel-4', 'SECCIÓN IV · CÓMO LEER TU GRÁFICA');
  renderPlaceholder('maxx-panel-5', 'SECCIÓN V · RESULTADOS');
  renderPlaceholder('maxx-panel-califn1', 'SIN Solución propuesta de MAXX');
  renderPlaceholder('maxx-panel-califn2', 'CON TU Propuesta de Aportaciones');
  renderPlaceholder('maxx-panel-cta', 'AGENDA TU CITA');

  // ---------- Inicializar ----------
  maxxCargarConfig(MAXX_CONFIG_URL).then(function(resultado) {
    var cfg = resultado.config.parametros;
    if (cfg.uma_diaria) { MAXX_UMA_MENSUAL = cfg.uma_diaria * 30.4; MAXX_TOPE_25_UMA = 25 * MAXX_UMA_MENSUAL; }
    if (cfg.descuento_salarial_bloque) MAXX_DESCUENTO_SALARIAL_BLOQUE = cfg.descuento_salarial_bloque;
    if (cfg.pmg_ley73) MAXX_PMG_LEY73 = cfg.pmg_ley73;
    if (cfg.pmg_ley97) MAXX_PMG_LEY97 = cfg.pmg_ley97;
    if (cfg.semanas_min_ley97_2026) MAXX_SEMANAS_MIN_LEY97 = cfg.semanas_min_ley97_2026;
    window.maxxConfigFuente = resultado.fuente; // util para verificar en consola si se leyo la hoja o la reserva

    renderPanel1();
    renderPanel2(false);
    renderPanel3(false);
    window.maxxSetGenero(window.maxxData.genero);
  });
