/**
 * MAXX — Pipeline de PDF para el Cuestionario Completo
 * ---------------------------------------------------------
 * Diferencia clave con el pipeline anterior (maxx-pdf-pipeline.gs):
 * Este SÍ manda el PDF directo al usuario final, sin que Javier intervenga.
 * También revisa que un mismo correo no reciba más de un PDF (protección real,
 * a nivel de HubSpot — no depende del navegador de nadie).
 *
 * OJO — sin propiedades nuevas: el plan de HubSpot de Javier tiene un límite de 10
 * propiedades personalizadas, y ya están todas usadas. Por eso este pipeline NO crea
 * una propiedad nueva para "PDF enviado" — en su lugar, guarda esa marca DENTRO del
 * mismo campo "Detalle Cuestionario MAXX" (detalle_cuestionario_maxx), que ya existe,
 * agregando una llave "pdfEnviadoFecha" al JSON que ya vive ahí.
 *
 * NUEVO (29-jul-2026): además de esa marca en HubSpot, este pipeline ahora también
 * llama a marcarPdfEnviado() — la función del Checador (ver Checador.gs, mismo proyecto)
 * que guarda su propio registro en Propiedades del Script. Esto sincroniza el checador
 * (que el modal de "Recibe TU Calificación en PDF" consulta ANTES de enviar, en vivo,
 * desde el navegador) con lo que este pipeline ya sabe. No reemplaza pdfEnviadoFecha en
 * HubSpot — ambos mecanismos coexisten, cada uno cumpliendo su función.
 *
 * Qué hace:
 * 1. Revisa periódicamente los envíos del formulario "Recibe TU Calificación en PDF" en HubSpot.
 * 2. Por cada envío NUEVO:
 *    a) Busca al contacto por correo en HubSpot y lee su "Detalle Cuestionario MAXX".
 *       Si ese JSON ya trae "pdfEnviadoFecha", se salta ese envío (no manda un segundo PDF).
 *    b) Si no lo tiene, genera un PDF con los datos y resultados del Cuestionario, y lo
 *       manda DIRECTO al correo del usuario.
 *    c) Le manda una copia a Javier también, a modo de registro.
 *    d) Actualiza el JSON en HubSpot agregando "pdfEnviadoFecha" (para que no se repita).
 *    e) Marca el correo en el registro del Checador (Propiedades del Script), tipo "pdf".
 *
 * IMPORTANTE — Configuración inicial (una sola vez), Javier:
 *
 * 1. En este proyecto de Apps Script (puede ser el MISMO proyecto que ya tienes, o uno nuevo — tú decides):
 *    a) Ve a "Configuración del proyecto" (⚙️) → "Propiedades del script".
 *    b) Si ya tienes ahí HUBSPOT_SERVICE_KEY del pipeline anterior, no hace falta que la agregues otra vez
 *       (Apps Script comparte las propiedades entre todos los archivos .gs del MISMO proyecto).
 *       Si es un proyecto nuevo, agrégala igual que la vez pasada:
 *         Nombre:  HUBSPOT_SERVICE_KEY
 *         Valor:   [tu clave de servicio, la que empieza con "pat-na1-..."]
 *
 * 2. Activa el disparador automático:
 *      Función a ejecutar: revisarEnviosCuestionario
 *      Fuente del evento: Basado en tiempo
 *      Tipo: Temporizador de minutos
 *      Cada: 15 minutos
 *
 * 3. Corre "pruebaManualCuestionario" una vez manualmente desde el editor para confirmar que todo
 *    funciona antes de dejarlo en automático.
 *
 * 4. Asegúrate de que Checador.gs también esté en este mismo proyecto — este pipeline llama
 *    a marcarPdfEnviado(), que vive ahí. Si no está, este pipeline seguirá funcionando igual
 *    (el paso 2e simplemente fallará silenciosamente en los logs), pero el checador del modal
 *    no sabrá que este correo ya recibió su PDF.
 */

// ==== CONFIGURACIÓN ====
var PORTAL_ID_CUESTIONARIO = "51441967";
var FORM_GUID_CUESTIONARIO = "56befb9b-6412-4b29-a1d2-51818a0f8697";
var CORREO_JAVIER = "jrowe@maxx.mx";

// Nombre interno de la propiedad "Detalle Cuestionario MAXX" (creada 28-jul-2026)
// Esta MISMA propiedad guarda tanto el detalle del Cuestionario como la marca de "PDF enviado"
// (agregamos una llave "pdfEnviadoFecha" al JSON) — así no necesitamos una propiedad nueva.
var CAMPO_DETALLE = "detalle_cuestionario_maxx";

// ==== FUNCIÓN PRINCIPAL (la que corre el disparador cada 15 min) ====
function revisarEnviosCuestionario() {
  var apiKey = PropertiesService.getScriptProperties().getProperty("HUBSPOT_SERVICE_KEY");
  if (!apiKey) {
    Logger.log("ERROR: No se encontró HUBSPOT_SERVICE_KEY en Propiedades del script. Configúrala antes de continuar.");
    return;
  }

  var submissions = obtenerEnviosCuestionario(apiKey);
  if (!submissions || submissions.length === 0) {
    Logger.log("No hay envíos nuevos para revisar.");
    return;
  }

  var procesados = obtenerProcesadosCuestionario();

  submissions.forEach(function(sub) {
    var idUnico = sub.conversionId;
    if (!idUnico || procesados.indexOf(idUnico) !== -1) {
      return; // ya se proceso antes en ESTA ejecucion del script, o no tiene ID
    }

    var datos = extraerCamposCuestionario(sub);
    if (!datos.correo) {
      Logger.log("Envío sin correo, se salta.");
      marcarComoProcesadoCuestionario(idUnico);
      return;
    }

    var contacto = buscarContactoPorCorreo(apiKey, datos.correo);
    var detalleGuardado = {};
    if (contacto && contacto.properties && contacto.properties[CAMPO_DETALLE]) {
      try { detalleGuardado = JSON.parse(contacto.properties[CAMPO_DETALLE]); } catch (err) { detalleGuardado = {}; }
    }

    if (detalleGuardado.pdfEnviadoFecha) {
      Logger.log("El correo " + datos.correo + " YA recibió su PDF antes (" + detalleGuardado.pdfEnviadoFecha + "). No se manda de nuevo.");
      marcarComoProcesadoCuestionario(idUnico);
      return;
    }

    var pdfBlob = generarPdfCuestionario(datos);
    enviarCorreosCuestionario(datos, pdfBlob);

    if (contacto && contacto.id) {
      marcarPdfEnviadoEnHubSpot(apiKey, contacto.id, datos.detalle);
    } else {
      Logger.log("AVISO: no se encontró el contactId de " + datos.correo + " para marcar el PDF como enviado. Revisa manualmente.");
    }

    // Sincroniza el registro del Checador (Propiedades del Script) — ver Checador.gs.
    // Si esa función no existe en este proyecto (Checador.gs no está agregado todavía),
    // esto lanzaría un error y detendría el resto del forEach, así que lo envolvemos en try/catch.
    try {
      marcarPdfEnviado(datos.correo, "pdf");
    } catch (err) {
      Logger.log("AVISO: no se pudo marcar el correo en el registro del Checador (¿está Checador.gs en este proyecto?). Detalle: " + err);
    }

    marcarComoProcesadoCuestionario(idUnico);
  });
}

// ==== OBTENER ENVÍOS DESDE HUBSPOT ====
function obtenerEnviosCuestionario(apiKey) {
  var url = "https://api.hubapi.com/form-integrations/v1/submissions/forms/" + FORM_GUID_CUESTIONARIO + "?limit=50";
  var options = {
    method: "get",
    headers: { "Authorization": "Bearer " + apiKey },
    muteHttpExceptions: true
  };

  var response = UrlFetchApp.fetch(url, options);
  var code = response.getResponseCode();

  if (code !== 200) {
    Logger.log("Error al consultar HubSpot. Código: " + code + " — Respuesta: " + response.getContentText());
    return [];
  }

  var data = JSON.parse(response.getContentText());
  return data.results || [];
}

// ==== EXTRAER CAMPOS DE UN ENVÍO (incluye el JSON completo del Cuestionario) ====
function extraerCamposCuestionario(sub) {
  var mapa = {};
  (sub.values || []).forEach(function(campo) {
    mapa[campo.name] = campo.value;
  });

  var detalleRaw = mapa[CAMPO_DETALLE] || "{}";
  var detalle = {};
  try {
    detalle = JSON.parse(detalleRaw);
  } catch (err) {
    Logger.log("No se pudo leer el JSON de detalle: " + err);
  }

  return {
    nombre: mapa["firstname"] || "",
    apellidos: mapa["lastname"] || "",
    correo: mapa["email"] || "",
    detalle: detalle,
    fecha: new Date(sub.submittedAt).toLocaleString("es-MX")
  };
}

// ==== BUSCAR CONTACTO POR CORREO (para leer/actualizar el Detalle Cuestionario) ====
function buscarContactoPorCorreo(apiKey, correo) {
  var url = "https://api.hubapi.com/crm/v3/objects/contacts/search";
  var payload = {
    filterGroups: [{
      filters: [{ propertyName: "email", operator: "EQ", value: correo }]
    }],
    properties: [CAMPO_DETALLE],
    limit: 1
  };
  var options = {
    method: "post",
    contentType: "application/json",
    headers: { "Authorization": "Bearer " + apiKey },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  };

  var response = UrlFetchApp.fetch(url, options);
  if (response.getResponseCode() !== 200) {
    Logger.log("Error buscando contacto: " + response.getContentText());
    return null;
  }

  var data = JSON.parse(response.getContentText());
  return (data.results && data.results.length > 0) ? data.results[0] : null;
}

// ==== MARCAR EN HUBSPOT QUE YA SE MANDÓ EL PDF (dentro del mismo JSON de Detalle) ====
function marcarPdfEnviadoEnHubSpot(apiKey, contactId, detalleActual) {
  var url = "https://api.hubapi.com/crm/v3/objects/contacts/" + contactId;
  var detalleActualizado = detalleActual || {};
  detalleActualizado.pdfEnviadoFecha = new Date().toISOString();

  var payload = { properties: {} };
  payload.properties[CAMPO_DETALLE] = JSON.stringify(detalleActualizado);

  var options = {
    method: "patch",
    contentType: "application/json",
    headers: { "Authorization": "Bearer " + apiKey },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  };

  var response = UrlFetchApp.fetch(url, options);
  if (response.getResponseCode() >= 300) {
    Logger.log("Error marcando PDF enviado: " + response.getContentText());
  }
}

// ==== GENERAR PDF — DISEÑO FINAL DE 3 PÁGINAS (mockup aprobado) ====
// Construye un HTML con el mismo diseño/CSS del mockup aprobado (maxx-pdf-mockup-completo.html),
// sustituyendo los datos reales del usuario, y lo convierte a PDF. Este es el reemplazo directo
// del PDF placeholder anterior — misma firma de función, mismo tipo de retorno (Blob de PDF).

function maxxFmtMoney(n) {
  return "$" + Math.round(n || 0).toLocaleString("es-MX");
}
function maxxFmtPct(x) {
  return ((x || 0) * 100).toFixed(2) + "%";
}

// Tabla de costo anual por plazo (misma que usa el motor del sitio) — para resaltar la fila correcta
var MAXX_PDF_TABLA_COSTO = [
  [1.5, 0.0480], [5, 0.0230], [10, 0.0170], [15, 0.0160], [20, 0.0150], [25, 0.0140]
];
// Tabla histórica S&P 500 — para resaltar la tasa más cercana a la elegida
var MAXX_PDF_TABLA_SP = [
  ["5 años", 0.1443, 0.0554], ["10 años", 0.1482, 0.0485], ["15 años", 0.1407, 0.0441],
  ["20 años", 0.1100, 0.0442], ["25 años", 0.0882, 0.0444], ["30 años", 0.1040, 0.0636]
];
// Últimos 10 años de inflación — para resaltar la más cercana a la elegida
var MAXX_PDF_TABLA_INFLACION = [
  [2015, 0.0213], [2016, 0.0336], [2017, 0.0677], [2018, 0.0483], [2019, 0.0283],
  [2020, 0.0315], [2021, 0.0736], [2022, 0.0782], [2023, 0.0466], [2024, 0.0421], [2025, 0.0369]
];

function maxxTablaCostoHTML(costoActual) {
  var filas = "";
  MAXX_PDF_TABLA_COSTO.forEach(function(row) {
    var esActual = Math.abs(row[1] - costoActual) < 0.0006;
    filas += '<tr' + (esActual ? ' class="fila-usada"' : '') + '><td><b>' + row[0] + ' años</b></td><td>' + maxxFmtPct(row[1]) + (esActual ? ' ◄ TU PLAZO' : '') + '</td></tr>';
  });
  return '<table class="tabla-nota"><tr><th>Plazo</th><th>Costo Anual</th></tr>' + filas + '</table>';
}

function maxxTablaSPHTML(tasaActual) {
  var filas = "";
  MAXX_PDF_TABLA_SP.forEach(function(row) {
    var esActual = Math.abs(row[1] - tasaActual) < 0.006;
    filas += '<tr' + (esActual ? ' class="fila-usada"' : '') + '><td><b>' + row[0] + '</b></td><td>' + maxxFmtPct(row[1]) + '</td><td>' + maxxFmtPct((1 + row[1]) / (1 + row[2]) - 1) + (esActual ? ' ◄ TASA ACTUAL' : '') + '</td></tr>';
  });
  return '<table class="tabla-nota"><tr><th>Periodo</th><th>Nominal</th><th>Real</th></tr>' + filas + '</table>';
}

function maxxTablaInflacionHTML(inflacionActual) {
  // Encabezado: se repite un par "Año | Inflación" por cada par de columnas que trae
  // cada renglón (4 pares por renglón — antes solo traía 1 par de encabezados para 4
  // pares de datos, dejando 6 columnas sin título; ya corregido).
  var encabezado = '<tr>' + '<th>Año</th><th>Inflación</th>'.repeat(4) + '</tr>';

  function construirFila(grupo) {
    var celdas = grupo.map(function(r) {
      var esActual = Math.abs(r[1] - inflacionActual) < 0.003;
      return '<td class="col-año' + (esActual ? ' fila-usada' : '') + '"><b>' + r[0] + '</b></td><td' + (esActual ? ' class="fila-usada"' : '') + '>' + maxxFmtPct(r[1]) + '</td>';
    }).join('');
    // Completar con celdas vacías si el grupo trae menos de 4 pares, para que la
    // columna siga alineada con el encabezado.
    var faltantes = 4 - grupo.length;
    for (var i = 0; i < faltantes; i++) { celdas += '<td></td><td></td>'; }
    return '<tr>' + celdas + '</tr>';
  }

  return '<table class="tabla-nota tabla-nota-chica">' + encabezado +
    construirFila(MAXX_PDF_TABLA_INFLACION.slice(0, 4)) +
    construirFila(MAXX_PDF_TABLA_INFLACION.slice(4, 8)) +
    construirFila(MAXX_PDF_TABLA_INFLACION.slice(8, 11)) +
    '</table>';
}

// Construye una gráfica SVG aproximada (acumulación → retiro → desacumulación), usando los
// valores resumen ya calculados (no tenemos la serie año-por-año completa en el PDF, así que
// se interpola una curva suave con los mismos puntos clave que usa la gráfica del sitio).
function maxxGraficaSvgPdf(det) {
  var edadActual = det.edadActual || 0;
  var edadRetiro = det.edadRetiro || 65;
  var esperanzaVida = det.esperanzaVida || 18;
  var edadEsperanza = Math.round(edadRetiro + esperanzaVida);
  var edadMax = Math.max(edadEsperanza + 3, edadRetiro + 5);
  var fondo = det.fondoAlRetiro || 0;
  var califCon = det.califCon || 0;

  var ancho = 500, alto = 230;
  var mIzq = 58, mDer = 20, mSup = 20, mInf = 24;
  function escX(edad) { return mIzq + ((edad - edadActual) / (edadMax - edadActual)) * (ancho - mIzq - mDer); }
  var maxY = Math.max(fondo, 1) * 1.15;
  function escY(v) { return (alto - mInf) - (v / maxY) * (alto - mInf - mSup); }

  // Punto donde el capital se agota (aprox, si la calificación CON no llega a 100)
  var edadAgota = califCon >= 100 ? edadEsperanza : Math.round(edadRetiro + esperanzaVida * Math.min(1, califCon / 100));

  var xRetiro = escX(edadRetiro), yRetiro = escY(fondo);
  var xFinal = escX(edadAgota <= edadMax ? edadAgota : edadMax);
  var yFinal = califCon >= 100 ? escY(fondo * 0.55) : escY(0);

  var pathAcum = "M " + escX(edadActual).toFixed(1) + " " + escY(0).toFixed(1) +
    " C " + escX(edadActual + (edadRetiro - edadActual) * 0.5).toFixed(1) + " " + escY(fondo * 0.28).toFixed(1) +
    ", " + escX(edadRetiro - (edadRetiro - edadActual) * 0.15).toFixed(1) + " " + escY(fondo * 0.78).toFixed(1) +
    ", " + xRetiro.toFixed(1) + " " + yRetiro.toFixed(1);
  var pathDesacum = "M " + xRetiro.toFixed(1) + " " + yRetiro.toFixed(1) +
    " C " + escX(edadRetiro + (edadAgota - edadRetiro) * 0.4).toFixed(1) + " " + escY(fondo * 0.65).toFixed(1) +
    ", " + escX(edadRetiro + (edadAgota - edadRetiro) * 0.75).toFixed(1) + " " + escY(fondo * 0.25).toFixed(1) +
    ", " + xFinal.toFixed(1) + " " + yFinal.toFixed(1);

  var svg = '<svg viewBox="0 0 ' + ancho + ' ' + alto + '" xmlns="http://www.w3.org/2000/svg" style="width:100%;">';
  svg += '<line x1="' + mIzq + '" y1="' + mSup + '" x2="' + mIzq + '" y2="' + (alto - mInf) + '" stroke="#8A8778" stroke-width="1"/>';
  svg += '<line x1="' + mIzq + '" y1="' + (alto - mInf) + '" x2="' + (ancho - mDer) + '" y2="' + (alto - mInf) + '" stroke="#8A8778" stroke-width="1"/>';
  [0.25, 0.5, 0.75, 1].forEach(function(f) {
    var y = escY(maxY * f * 0.87);
    svg += '<line x1="' + mIzq + '" y1="' + y.toFixed(1) + '" x2="' + (ancho - mDer) + '" y2="' + y.toFixed(1) + '" stroke="#D8D6CC" stroke-width="1"/>';
    svg += '<text x="' + (mIzq - 8) + '" y="' + (y + 4).toFixed(1) + '" text-anchor="end" font-size="12" font-weight="600" fill="#3D3B36">' + maxxFmtMoney(maxY * f * 0.87).replace("$", "$") + '</text>';
  });
  svg += '<line x1="' + xRetiro.toFixed(1) + '" y1="' + mSup + '" x2="' + xRetiro.toFixed(1) + '" y2="' + (alto - mInf) + '" stroke="#042C53" stroke-width="1.5" stroke-dasharray="4,3"/>';
  svg += '<text x="' + xRetiro.toFixed(1) + '" y="' + (alto - 6) + '" text-anchor="middle" font-size="13" font-weight="700" fill="#042C53">Retiro: ' + edadRetiro + '</text>';
  if (escX(edadEsperanza) <= ancho - mDer) {
    svg += '<line x1="' + escX(edadEsperanza).toFixed(1) + '" y1="' + mSup + '" x2="' + escX(edadEsperanza).toFixed(1) + '" y2="' + (alto - mInf) + '" stroke="#042C53" stroke-width="1.5" stroke-dasharray="4,3"/>';
    svg += '<text x="' + escX(edadEsperanza).toFixed(1) + '" y="12" text-anchor="middle" font-size="12" font-weight="700" fill="#042C53">Esp. vida: ' + edadEsperanza + '</text>';
  }
  svg += '<path d="' + pathAcum + '" fill="none" stroke="#EF9F27" stroke-width="3.5" stroke-linecap="round"/>';
  svg += '<path d="' + pathDesacum + '" fill="none" stroke="#639922" stroke-width="3.5" stroke-linecap="round"/>';
  for (var e = edadActual; e <= edadMax; e += 5) {
    svg += '<text x="' + escX(e).toFixed(1) + '" y="' + (alto - 6) + '" text-anchor="middle" font-size="12" font-weight="600" fill="#3D3B36">' + Math.round(e) + '</text>';
  }
  svg += '</svg>';
  return svg;
}

function maxxEncabezadoHTML(compacto) {
  var alto = compacto ? "36px" : "46px";
  return '<div class="encabezado' + (compacto ? ' encabezado-compacto' : '') + '">' +
    '<div class="titulo-doc' + (compacto ? '-chico' : '') + '">Calificación Financiera Personal</div>' +
    '<div style="font-family:Roboto,Arial,sans-serif;font-weight:800;color:#fff;font-size:' + alto + ';letter-spacing:0.5px;">MAXX<span style="color:#8FD14F;">.</span></div>' +
    '</div>';
}

function maxxPieHTML(pagina) {
  return '<div class="pie"><div>Confidencial</div><div class="centro">MAXX — Calificación Financiera Personal</div><div>Página ' + pagina + '/3</div></div>';
}

// Genera un código QR como imagen embebida (data URI) para una URL dada.
// Usa un servicio público de generación de QR + UrlFetchApp (sí tiene acceso a red,
// a diferencia del conversor de HTML a PDF). Si falla por cualquier razón (sin cuota,
// servicio caído, etc.), regresa "" — el HTML sigue mostrando el link visible como respaldo.
function maxxQrDataUri(url, sizePx) {
  try {
    var qrUrl = "https://api.qrserver.com/v1/create-qr-code/?size=" + sizePx + "x" + sizePx + "&data=" + encodeURIComponent(url);
    var resp = UrlFetchApp.fetch(qrUrl, { muteHttpExceptions: true });
    if (resp.getResponseCode() !== 200) return "";
    var b64 = Utilities.base64Encode(resp.getBlob().getBytes());
    return "data:image/png;base64," + b64;
  } catch (err) {
    return "";
  }
}

function maxxImagenPlaceholderHTML(alturaMin) {
  return '<div style="border:1.5px dashed #C7C4B8;border-radius:10px;padding:14px;text-align:center;color:#8A8778;font-size:11.5px;font-weight:600;min-height:' + alturaMin + 'px;display:flex;align-items:center;justify-content:center;">IMAGEN<br>(se arma en Canva)</div>';
}

function maxxCtaQrHTML(urlQr, urlMostrar, sizePx, tituloHtml, tamTitulo, colorLink, colorTitulo) {
  var qr = maxxQrDataUri(urlQr, sizePx);
  tamTitulo = tamTitulo || 14;
  colorLink = colorLink || "#5F5E5A";
  colorTitulo = colorTitulo || "#8FD14F";
  return '<div style="text-align:center;">' +
    '<div style="font-size:' + tamTitulo + 'px;font-weight:800;color:' + colorTitulo + ';margin-bottom:8px;line-height:1.3;">' + tituloHtml + '</div>' +
    (qr ? ('<img src="' + qr + '" style="width:' + sizePx + 'px;height:' + sizePx + 'px;" />') : '') +
    '<div style="font-size:11px;color:' + colorLink + ';margin-top:7px;font-weight:700;">Escanea, o visita: <b>' + urlMostrar + '</b></div>' +
    '</div>';
}

function maxxConstruirHtmlPdfCuestionario(d, det) {
  var edadActual = det.edadActual || 0;
  var edadRetiro = det.edadRetiro || 65;
  var esperanzaVida = det.esperanzaVida || 0;
  var plazo = det.plazoComprometido || (edadRetiro - edadActual);
  var tasaRealNeta = det.tasaRealNetaCosto !== undefined ? det.tasaRealNetaCosto : ((1 + (det.tasaSolucionNeta || 0)) / (1 + (det.inflacion || 0)) - 1);
  var aforeTexto = det.tieneAfore === "S" ? ("Sí — " + (det.ley73 === "S" ? "Ley 73" : "Ley 97")) : "No";
  var edadCapitalAgota = det.califCon >= 100 ? null : Math.round(edadRetiro + esperanzaVida * Math.min(1, (det.califCon || 0) / 100));
  var textoCobertura = edadCapitalAgota ? ("hasta los " + edadCapitalAgota + " años de edad") : "durante toda tu esperanza de vida";

  var css = '<style>' +
    '*{box-sizing:border-box;margin:0;padding:0;}' +
    'body{background:#e8e8e4;font-family:Roboto,Arial,sans-serif;}' +
    '.hoja{width:816px;min-height:1056px;background:#fff;margin:0 auto;display:flex;flex-direction:column;position:relative;page-break-after:always;}' +
    '.encabezado{background:#042C53;color:#fff;padding:10px 40px;display:flex;justify-content:space-between;align-items:center;}' +
    '.encabezado-compacto{padding:8px 40px;}' +
    '.titulo-doc{font-size:22px;font-weight:700;letter-spacing:0.3px;}' +
    '.titulo-doc-chico{font-size:15px;font-weight:700;letter-spacing:0.3px;}' +
    '.pie{display:flex;justify-content:space-between;align-items:center;padding:12px 40px;border-top:1px solid #E6E4DA;font-size:10.5px;color:#8A8778;}' +
    '.pie .centro{font-weight:600;color:#042C53;}' +
    '.fila{display:flex;justify-content:space-between;font-size:13.5px;padding:5px 0;color:#3D3B36;}' +
    '.fila b{color:#042C53;}' +
    '.seccion-mini{background:#F5F4F0;border-radius:10px;padding:14px 16px;margin-bottom:14px;}' +
    '.seccion-mini h4{font-size:13px;color:#042C53;letter-spacing:0.4px;margin-bottom:9px;font-weight:700;}' +
    '.cuerpo1{flex:1;padding:26px 40px 10px 40px;display:flex;flex-direction:column;}' +
    '.fila-saludo-fecha{display:flex;justify-content:space-between;align-items:baseline;margin-bottom:10px;}' +
    '.saludo{font-size:26px;font-weight:800;color:#042C53;}' +
    '.nombre-usuario{color:#3B6D11;}' +
    '.fecha-doc{font-size:13px;color:#5F5E5A;font-weight:500;}' +
    '.bienvenida{font-size:15px;color:#3D3B36;line-height:1.6;margin:0 0 24px 0;}' +
    '.banner-emotivo{margin-top:16px;background:linear-gradient(115deg,#1F3B57 0%,#042C53 45%,#0B4A2E 100%);border-radius:12px;padding:26px 30px;display:flex;align-items:center;justify-content:center;flex:1;min-height:160px;}' +
    '.banner-emotivo .frase{color:#fff;font-size:19px;font-weight:700;text-align:center;line-height:1.5;}' +
    '.banner-emotivo .frase span{color:#8FD14F;}' +
    '.cuerpo2{flex:1;padding:22px 40px 10px 40px;}' +
    '.titulo-pagina2{font-size:18px;color:#042C53;font-weight:800;margin-bottom:16px;}' +
    '.flex2col{display:flex;gap:16px;align-items:flex-start;}' +
    '.col-principal{flex:2;}.col-lateral{flex:1;}' +
    '.titulo-seccion2{font-size:13.5px;color:#042C53;font-weight:700;letter-spacing:0.4px;margin-bottom:9px;}' +
    '.como-leer{background:#F5F4F0;border-radius:10px;padding:14px 16px;font-size:12.5px;color:#3D3B36;line-height:1.55;}' +
    '.como-leer p{margin-bottom:7px;}' +
    '.caja-resultados{background:#EAF3DE;border-radius:10px;padding:18px;}' +
    '.caja-resultados .monto{font-size:30px;font-weight:800;color:#3B6D11;line-height:1.1;}' +
    '.caja-resultados .detalle-fila{display:flex;justify-content:space-between;font-size:13.5px;color:#3D3B36;padding:5px 0;}' +
    '.caja-calif{background:#F5F4F0;border-radius:10px;padding:18px;text-align:center;margin-bottom:12px;}' +
    '.caja-calif .numero{font-size:52px;font-weight:800;line-height:1;}' +
    '.caja-calif.sin .numero{color:#042C53;}.caja-calif.con .numero{color:#3B6D11;}' +
    '.caja-calif .etiqueta{font-size:13px;color:#5F5E5A;font-weight:700;margin-bottom:6px;}' +
    '.caja-calif .gap{font-size:13.5px;font-weight:700;color:#042C53;margin-top:4px;}' +
    '.caja-calif .msg{font-size:12.5px;color:#3D3B36;margin-top:8px;line-height:1.4;}' +
    '.caja-calif.con .msg{color:#3B6D11;font-weight:600;}' +
    '.cierre-cta{background:#042C53;color:#fff;border-radius:12px;margin-top:18px;display:flex;align-items:stretch;overflow:hidden;min-height:230px;}' +
    '.cierre-texto{flex:2;padding:22px 24px;display:flex;flex-direction:column;align-items:center;text-align:center;justify-content:center;}' +
    '.cierre-imagen{flex:1;background:rgba(255,255,255,0.08);border-left:1.5px dashed rgba(255,255,255,0.35);display:flex;align-items:center;justify-content:center;text-align:center;font-size:11px;color:rgba(255,255,255,0.75);padding:10px;font-weight:600;line-height:1.4;}' +
    '.cierre-cta .frase-linea1{font-size:18px;font-weight:800;line-height:1.3;margin-bottom:10px;}' +
    '.cierre-cta .verde{color:#8FD14F;display:block;margin-top:2px;}' +
    '.cierre-cta .frase-grande{font-size:23px;font-weight:800;color:#8FD14F;line-height:1.15;margin-bottom:10px;}' +
    '.cierre-cta .frase-chica{font-size:10.5px;color:#B9C6D6;margin-top:8px;}' +
    '.cuerpo3{flex:1;padding:26px 40px 10px 40px;}' +
    '.nota-item{display:flex;gap:12px;margin-bottom:18px;}' +
    '.nota-num{width:26px;height:26px;border-radius:50%;background:#042C53;color:#fff;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:800;flex-shrink:0;}' +
    '.nota-texto{flex:1;min-width:0;font-size:12px;color:#3D3B36;line-height:1.55;}' +
    '.nota-texto b{color:#042C53;}' +
    '.nota-origen{font-size:10.5px;color:#378ADD;font-weight:700;text-align:center;margin-bottom:6px;}' +
    '.tabla-nota{border-collapse:collapse;margin:9px auto 0 auto;width:auto;font-size:11px;border:1px solid #C9CBD1;}' +
    '.tabla-nota th,.tabla-nota td{border:1px solid #C9CBD1;padding:3px 10px;text-align:center;white-space:nowrap;}' +
    '.tabla-nota th{background:#E6F1FB;color:#042C53;font-weight:700;}' +
    '.tabla-nota td{color:#5F5E5A;}' +
    '.fila-usada,td.fila-usada{background:#EAF3DE !important;color:#3B6D11 !important;font-weight:700;}' +
    '.tabla-nota-chica{font-size:10.5px;}.tabla-nota-chica th,.tabla-nota-chica td{padding:2px 7px;}' +
    '.col-año{background:#F0F0EC;font-weight:700;color:#5F5E5A;text-align:center;}' +
    '.flex-lado{display:flex;gap:14px;align-items:stretch;margin-bottom:14px;}' +
    '.flex-lado .seccion-mini{flex:1;margin-bottom:0;}' +
    '</style>';

  var citaUrlP1 = "https://meetings.hubspot.com/javier-rowe-hoppenstedt?utm_source=pdf&utm_medium=calificacion&utm_campaign=p1_hero";

  var pagina1 = '<div class="hoja">' + maxxEncabezadoHTML(false) +
    '<div class="cuerpo1">' +
    '<div class="fila-saludo-fecha"><div class="saludo">Hola, <span class="nombre-usuario">' + d.nombre + ' ' + d.apellidos + '</span> 👋</div><div class="fecha-doc">' + d.fecha + '</div></div>' +
    '<div class="bienvenida" style="margin-bottom:14px;font-size:15px;line-height:1.5;"><b style="color:#042C53;">Gracias por tu confianza al compartirnos TU información.</b><br><b style="color:#378ADD;">Este es TU primer paso hacia TU Libertad Económica.</b></div>' +
    '<div class="flex2col" style="margin-bottom:16px;align-items:stretch;">' +
    '<div class="col-principal">' +
    '<div class="caja-resultados" style="display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;height:100%;min-height:230px;padding:22px;">' +
    '<div style="font-size:14px;color:#3B6D11;font-weight:700;line-height:1.4;">Con el nivel de aportaciones de <b>' + maxxFmtMoney(det.capacidadAhorro) + '</b><br>y para la edad de retiro de <b>' + edadRetiro + ' años</b>, acumularás:</div>' +
    '<div class="monto" style="margin-top:8px;">' + maxxFmtMoney(det.fondoAlRetiro) + ' pesos</div>' +
    '<div style="font-size:12.5px;color:#3B6D11;font-weight:700;margin-top:2px;">(incluye inflación<sup style="color:#B5651D;font-weight:800;font-size:10px;">3</sup>)</div>' +
    '</div></div>' +
    '<div class="col-lateral" style="display:flex;align-items:center;justify-content:center;background:#F5F4F0;border-radius:10px;">' +
    maxxCtaQrHTML(citaUrlP1, "www.maxx.mx", 116, "Agenda TU Cita.<br>¡Empieza YA! →", 14, "#5F5E5A", "#3B6D11") +
    '</div></div>' +
    '<div class="flex-lado">' +
    '<div class="seccion-mini"><h4>SECCIÓN I · TU LIBERTAD ECONÓMICA</h4>' +
    '<div class="fila"><span>Edad actual</span><b>' + edadActual + ' años</b></div>' +
    '<div class="fila"><span>Edad de retiro</span><b>' + edadRetiro + ' años</b></div>' +
    '<div class="fila"><span>Monto mensual deseado</span><b>' + maxxFmtMoney(det.montoDeseado) + '</b></div></div>' +
    '<div class="seccion-mini"><h4>SECCIÓN II · CON QUÉ CUENTAS</h4>' +
    '<div class="fila"><span>Capacidad de ahorro mensual</span><b>' + maxxFmtMoney(det.capacidadAhorro) + '</b></div>' +
    '<div class="fila"><span>¿Tienes AFORE?</span><b>' + aforeTexto + '</b></div>' +
    (det.tieneAfore === "S" ? ('<div class="fila"><span>Años cotizando</span><b>' + (det.aniosCotizando || 0) + ' años</b></div>') : '') +
    '</div></div>' +
    '<div class="banner-emotivo" style="margin-top:0;min-height:100px;padding:16px 30px;position:relative;">' +
    '<div style="position:absolute;top:8px;left:14px;font-size:9.5px;color:rgba(255,255,255,0.65);font-weight:700;">🖼️ IMAGEN (Canva) — el texto va sobre la foto</div>' +
    '<div class="frase" style="font-size:16px;">"TU calificación de HOY no define TU destino.<br><span>TÚ lo haces. Empieza HOY.</span>"</div></div>' +
    '<div class="seccion-mini" style="margin-top:12px;background:#F0F0EC;">' +
    '<h4>RESPALDO TÉCNICO DE TU RESULTADO · SECCIÓN III · INDICADORES</h4>' +
    '<div style="display:flex;align-items:center;justify-content:space-between;gap:4px;margin-top:6px;">' +
    '<div style="text-align:center;flex:1;"><div style="text-align:center;font-size:11px;color:#3D3B36;font-weight:600;">Bruta<sup style="color:#B5651D;font-weight:800;font-size:9px;">1</sup></div><div style="text-align:center;font-size:16px;font-weight:800;color:#042C53;">' + maxxFmtPct(det.tasaSolucion) + '</div></div>' +
    '<div style="color:#a8a69d;font-size:14px;">−</div>' +
    '<div style="text-align:center;flex:1;"><div style="text-align:center;font-size:11px;color:#3D3B36;font-weight:600;">Costo<sup style="color:#B5651D;font-weight:800;font-size:9px;">2</sup></div><div style="text-align:center;font-size:16px;font-weight:800;color:#042C53;">' + maxxFmtPct(det.costoAnualAplicado) + '</div></div>' +
    '<div style="color:#a8a69d;font-size:14px;">−</div>' +
    '<div style="text-align:center;flex:1;"><div style="text-align:center;font-size:11px;color:#3D3B36;font-weight:600;">Inflación<sup style="color:#B5651D;font-weight:800;font-size:9px;">3</sup></div><div style="text-align:center;font-size:16px;font-weight:800;color:#042C53;">' + maxxFmtPct(det.inflacion) + '</div></div>' +
    '<div style="color:#a8a69d;font-size:14px;">=</div>' +
    '<div style="text-align:center;flex:1.3;"><div style="text-align:center;font-size:11px;color:#3D3B36;font-weight:700;">Real Neta</div><div style="text-align:center;font-size:23px;font-weight:800;color:#3B6D11;">' + maxxFmtPct(tasaRealNeta) + '</div></div>' +
    '</div><div style="font-size:10.5px;color:#3D3B36;font-weight:600;margin-top:8px;line-height:1.4;text-align:center;">Respaldo técnico — detalle completo (incluida la tabla de inflación) en la Página 3.</div></div>' +
    '</div>' + maxxPieHTML(1) + '</div>';

  var edadCapitalAgotaTxt = edadCapitalAgota ? edadCapitalAgota : "";
  var bodyCosto = maxxTablaCostoHTML(det.costoAnualAplicado);
  var bodySP = maxxTablaSPHTML(det.tasaSolucion);
  var bodyInflacion = maxxTablaInflacionHTML(det.inflacion);

  var citaUrlP2 = "https://meetings.hubspot.com/javier-rowe-hoppenstedt?utm_source=pdf&utm_medium=calificacion&utm_campaign=p2_cierre";

  var pagina2 = '<div class="hoja">' + maxxEncabezadoHTML(true) +
    '<div class="cuerpo2">' +
    '<div class="titulo-pagina2">TU Calificación: CON Aportaciones.</div>' +
    '<div class="flex2col">' +
    '<div class="col-principal">' +
    '<div class="titulo-seccion2">GRÁFICA · ACUMULACIÓN Y DESACUMULACIÓN</div>' +
    maxxGraficaSvgPdf(det) +
    '<div style="text-align:center;font-size:13px;font-weight:700;color:#042C53;margin-top:8px;margin-bottom:16px;line-height:1.4;">' +
    'Montos a tus ' + edadRetiro + ' años de edad — <b>a valor del momento de tu retiro</b> (no de hoy):<br>' +
    'Acumulado ' + maxxFmtMoney(det.fondoAlRetiro) + ' &nbsp;·&nbsp; Deseado ' + maxxFmtMoney(det.montoDeseado) + '/mes &nbsp;·&nbsp; Pensión ' + maxxFmtMoney(det.pensionMensualAlRetiro) + '/mes</div>' +
    '<div class="titulo-seccion2">SECCIÓN V · RESULTADOS</div>' +
    '<div class="caja-resultados">' +
    '<div style="font-size:14px;color:#3B6D11;font-weight:700;margin-bottom:8px;line-height:1.4;text-align:center;">🎉 Esto es lo que se estima que tus aportaciones acumularán para tu retiro a los ' + edadRetiro + ' años de edad</div>' +
    '<div class="monto" style="text-align:center;">' + maxxFmtMoney(det.fondoAlRetiro) + '</div>' +
    '<div style="font-size:12.5px;color:#3B6D11;font-weight:700;margin-bottom:10px;text-align:center;">(incluye inflación)</div>' +
    '<div style="font-size:12.5px;color:#3B6D11;font-weight:600;line-height:1.5;margin-bottom:3px;">Lo logras aportando <b>' + maxxFmtMoney(det.capacidadAhorro) + '/mes</b>.</div>' +
    '<div style="font-size:12.5px;color:#3B6D11;font-weight:600;line-height:1.5;margin-bottom:3px;">Invertido a una tasa nominal de <b>' + maxxFmtPct(det.tasaSolucion) + ' anual</b> (estimado con S&P500).</div>' +
    '<div style="font-size:12.5px;color:#3B6D11;font-weight:600;line-height:1.5;margin-bottom:3px;">Ya descontado el costo de tu plan<sup style="color:#042C53;font-weight:800;font-size:10px;">2</sup> (' + maxxFmtPct(det.costoAnualAplicado) + '), tu tasa nominal neta es de <b>' + maxxFmtPct(det.tasaSolucionNeta) + ' anual</b>.</div>' +
    '<div style="font-size:12.5px;color:#3B6D11;font-weight:600;line-height:1.5;margin-bottom:3px;">En poder de compra real<sup style="color:#042C53;font-weight:800;font-size:10px;">3</sup>, esto equivale a la <b>Tasa Real Neta de ' + maxxFmtPct(tasaRealNeta) + '</b>.</div>' +
    '<div style="font-size:12.5px;color:#3B6D11;font-weight:600;line-height:1.5;margin-bottom:10px;">Tu saldo seguirá invertido y te alcanzará para <b>' + maxxFmtMoney(det.montoDeseado) + '/mes de hoy</b>, ' + textoCobertura + '.</div>' +
    '<div style="font-size:13px;color:#3B6D11;font-weight:700;margin-bottom:12px;line-height:1.4;">MAXX te puede ayudar a lograr más.<br>Agenda TU Cita.</div>' +
    '<div class="detalle-fila"><span>Necesidad total</span><b>' + maxxFmtMoney(det.necesidadTotal) + '</b></div>' +
    '<div class="detalle-fila"><span>Tu pensión IMSS/AFORE cubre</span><b>' + maxxFmtMoney(det.pensionFondeada) + '</b></div>' +
    '<div class="detalle-fila"><span>Tu pensión vía AFORE, al retiro (mensual)</span><b>' + maxxFmtMoney(det.pensionMensualAlRetiro) + '</b></div>' +
    '<div class="detalle-fila"><span>Tu ahorro actual cubre</span><b>' + maxxFmtMoney(det.ahorroFondeado) + '</b></div>' +
    '<div class="detalle-fila"><span>Costo anual de tu plan<sup style="color:#042C53;font-weight:800;font-size:9px;">2</sup></span><b>' + maxxFmtPct(det.costoAnualAplicado) + '</b></div>' +
    '</div></div>' +
    '<div class="col-lateral">' +
    '<div class="titulo-seccion2">SECCIÓN IV · CÓMO LEER TU GRÁFICA</div>' +
    '<div class="como-leer">' +
    '<p><b>①</b> <b style="color:#EF9F27;">Naranja</b>: tu dinero creciendo mes a mes, hasta tu retiro.</p>' +
    '<p><b>②</b> Al llegar a tu retiro, nace la línea <b style="color:#639922;">verde</b>.</p>' +
    '<p><b>③</b> La <b style="color:#639922;">verde</b> se usa cada mes para completar lo que tu pensión no alcanza.</p>' +
    '<p><b>④</b> Las líneas verticales marcan tu edad de retiro y tu esperanza de vida.</p>' +
    '<p style="margin-bottom:0;"><b>⑤</b> Si la <b style="color:#639922;">verde</b> llega a $0 antes de tu esperanza de vida, tu capital se agotó — de ahí en adelante vives solo de tu pensión.</p>' +
    '</div>' +
    '<div class="titulo-seccion2" style="margin-top:18px;">TUS CALIFICACIONES</div>' +
    '<div class="caja-calif sin"><div class="etiqueta">SIN Solución MAXX</div><div class="numero">' + (det.califSin || 0) + '<span style="font-size:13px;">/100</span></div><div class="gap">Tu GAP: ' + (100 - (det.califSin || 0)) + '%</div><div class="msg">Este es tu punto de partida.<br>Vamos a mejorarlo.</div></div>' +
    '<div class="caja-calif con"><div class="etiqueta">CON TU Propuesta</div><div class="numero">' + (det.califCon || 0) + '<span style="font-size:13px;">/100</span></div><div class="gap">Tu GAP: ' + (100 - (det.califCon || 0)) + '%</div><div class="msg">' + (det.califCon >= 100 ? "Con TUS Aportaciones podrás cerrar la brecha." : "Con TUS Aportaciones cierras una parte de la brecha.") + '</div></div>' +
    '</div></div>' +
    '<div class="cierre-cta">' +
    '<div class="cierre-texto">' +
    '<div class="frase-linea1">TU calificación de HOY<span class="verde" style="font-size:21px;">no define TU destino.</span></div>' +
    '<div class="frase-grande">TÚ lo haces.</div>' +
    '<div style="font-size:13px;font-weight:600;margin-bottom:4px;">En 30 minutos, te mostramos cómo mejorar TU Calificación.</div>' +
    '<div class="frase-chica" style="margin-top:0;margin-bottom:12px;">Consulta Gratuita. Sin Compromiso.</div>' +
    maxxCtaQrHTML(citaUrlP2, "www.maxx.mx", 118, "¿Quieres conocer<br>la Solución Ideal para TI?<br>Agenda TU Cita. ¡Hazlo YA! →", 19, "#D9E4F0") +
    '</div>' +
    '<div class="cierre-imagen">IMAGEN<br>(se arma en Canva)</div>' +
    '</div>' +
    '</div>' + maxxPieHTML(2) + '</div>';

  var pagina3 = '<div class="hoja">' + maxxEncabezadoHTML(true) +
    '<div class="cuerpo3">' +
    '<div class="titulo-seccion2" style="font-size:16px;margin-bottom:20px;">NOTAS ACLARATORIAS</div>' +
    '<div class="nota-item"><div class="nota-num">1</div><div class="nota-texto"><b>Rendimiento — Solución propuesta por MAXX.</b> El S&P 500 es una excelente opción para hacer crecer tu dinero: incluso después de descontar la inflación, sigue dando rendimientos reales atractivos, año tras año.<div class="nota-origen" style="margin-top:9px;">Referencia: Página 1, Sección II</div>' + bodySP + '</div></div>' +
    '<div class="nota-item"><div class="nota-num">2</div><div class="nota-texto"><b>Costo de tu plan.</b> Entre más largo el plazo que eliges para tu plan, más baja tu tasa de costo anual promedio.<div class="nota-origen" style="margin-top:9px;">Referencia: Página 1, Sección II · Página 2, Sección V</div>' + bodyCosto + '</div></div>' +
    '<div class="nota-item"><div class="nota-num">3</div><div class="nota-texto"><b>Inflación anual.</b> En México ha habido años con más de 15% de inflación. Por eso es mejor ser conservador al proyectar.<div class="nota-origen" style="margin-top:9px;">Últimos 10 años · Fuente: INEGI/Banxico · Referencia: Página 1, Sección II</div>' + bodyInflacion + '</div></div>' +
    '<div class="nota-item"><div class="nota-num">4</div><div class="nota-texto"><b>Esperanza de vida.</b> Si te retiras a los ' + edadRetiro + ' años, tu esperanza de vida remanente es de aproximadamente ' + Math.round(esperanzaVida * 10) / 10 + ' años más — tu dinero necesita alcanzarte hasta cerca de los ' + Math.round(edadRetiro + esperanzaVida) + ' años.<div class="nota-origen">Referencia: Página 2, Gráfica</div></div></div>' +
    '<div class="nota-item"><div class="nota-num">5</div><div class="nota-texto"><b>MAXX SIEMPRE te muestra la verdad completa.</b> Este cálculo YA incluye: a) el costo real de tu plan, b) tu pensión IMSS/AFORE. Otros cotizadores NO restan costos, y muchos ni siquiera calculan tu pensión. Por eso, si comparas cifras, MAXX puede verse con un monto menor. Tu futuro merece números reales.<div class="nota-origen">Referencia: Página 2, Sección V y Calificaciones</div></div></div>' +
    '<div style="border:1.5px dashed #C7C4B8;border-radius:10px;padding:16px;text-align:center;color:#8A8778;font-size:12px;font-weight:600;min-height:110px;display:flex;align-items:center;justify-content:center;margin-top:8px;">IMAGEN — banner de cierre<br>(se arma en Canva)</div>' +
    '</div>' + maxxPieHTML(3) + '</div>';

  return '<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8">' + css + '</head><body>' + pagina1 + pagina2 + pagina3 + '</body></html>';
}

function generarPdfCuestionario(d) {
  var det = d.detalle || {};
  var html = maxxConstruirHtmlPdfCuestionario(d, det);

  var htmlBlob = Utilities.newBlob(html, "text/html", "temp_calificacion.html");
  var pdfBlob = htmlBlob.getAs("application/pdf");
  pdfBlob.setName("Calificacion_MAXX_" + d.nombre + "_" + d.apellidos + ".pdf");
  return pdfBlob;
}
// ==== ENVIAR CORREOS: al usuario DIRECTO, y copia a Javier ====
function enviarCorreosCuestionario(d, pdfBlob) {
  // --- Al usuario: el PDF, directo, sin intervención de Javier ---
  var asuntoUsuario = "TU Calificación Financiera Personal — MAXX";
  var cuerpoUsuario = "Hola " + d.nombre + ",\n\n" +
    "Gracias por confiar en MAXX para dar este paso hacia TU libertad económica.\n\n" +
    "Adjunto encontrarás TU Calificación Financiera Personal, con el resumen completo de tu situación actual y lo que puedes construir a partir de hoy.\n\n" +
    "Si tienes dudas o quieres platicarlo a detalle, con gusto te ayudamos. Puedes agendar TU Cita gratuita aquí:\n" +
    "https://meetings.hubspot.com/javier-rowe-hoppenstedt?utm_source=pdf&utm_medium=email&utm_campaign=cuestionario\n\n" +
    "Saludos,\nMAXX";

  GmailApp.sendEmail(d.correo, asuntoUsuario, cuerpoUsuario, {
    attachments: [pdfBlob]
  });

  // --- A Javier: copia de registro ---
  var asuntoJavier = "PDF enviado automáticamente — " + d.nombre + " " + d.apellidos;
  var cuerpoJavier = "Se envió el PDF automáticamente al usuario.\n\n" +
    "Nombre: " + d.nombre + " " + d.apellidos + "\n" +
    "Correo: " + d.correo + "\n" +
    "Fecha: " + d.fecha + "\n\n" +
    "Detalle completo:\n" + JSON.stringify(d.detalle, null, 2);

  GmailApp.sendEmail(CORREO_JAVIER, asuntoJavier, cuerpoJavier, {
    attachments: [pdfBlob]
  });
}

// ==== CONTROL DE ENVÍOS YA PROCESADOS EN ESTA EJECUCIÓN (evita duplicar si el script corre encimado) ====
function obtenerProcesadosCuestionario() {
  var raw = PropertiesService.getScriptProperties().getProperty("PROCESADOS_CUESTIONARIO");
  return raw ? JSON.parse(raw) : [];
}

function marcarComoProcesadoCuestionario(idUnico) {
  var procesados = obtenerProcesadosCuestionario();
  procesados.push(idUnico);
  if (procesados.length > 200) {
    procesados = procesados.slice(procesados.length - 200);
  }
  PropertiesService.getScriptProperties().setProperty("PROCESADOS_CUESTIONARIO", JSON.stringify(procesados));
}

// ==== FUNCIÓN DE PRUEBA MANUAL ====
function pruebaManualCuestionario() {
  revisarEnviosCuestionario();
  Logger.log("Prueba manual completada. Revisa tu correo (y el del usuario de prueba) y los logs de arriba.");
}
