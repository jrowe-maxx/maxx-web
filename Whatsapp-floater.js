(function() {
  var css = document.createElement('style');
  css.textContent = `
    #maxx-wa-btn {
      position: fixed; bottom: 24px; left: 24px; z-index: 9999;
      width: 56px; height: 56px; border-radius: 50%;
      background: #25D366; color: #FFF; border: none;
      box-shadow: 0 4px 14px rgba(0,0,0,0.25);
      display: none; align-items: center; justify-content: center;
      cursor: pointer; text-decoration: none;
      opacity: 0; transition: opacity 0.3s ease;
    }
    #maxx-wa-btn.visible { display: flex; opacity: 1; }
    #maxx-wa-btn svg { width: 30px; height: 30px; fill: #FFF; }
  `;
  document.head.appendChild(css);

  var mensaje = encodeURIComponent('Hola, vengo del sitio de MAXX y tengo una duda sobre mi Plan.');
  var link = document.createElement('a');
  link.id = 'maxx-wa-btn';
  link.href = 'https://wa.me/5215591984600?text=' + mensaje;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  link.title = 'Escríbenos por WhatsApp';
  link.innerHTML = '<svg viewBox="0 0 24 24"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z"/><path d="M12.001 2C6.478 2 2 6.478 2 12c0 1.821.487 3.53 1.338 5.003L2 22l5.116-1.334A9.94 9.94 0 0 0 12.001 22C17.523 22 22 17.522 22 12S17.523 2 12.001 2zm0 18.03a8.01 8.01 0 0 1-4.086-1.117l-.293-.174-3.033.791.81-2.958-.191-.303A8.01 8.01 0 1 1 20.03 12a8.02 8.02 0 0 1-8.029 8.03z"/></svg>';
  document.body.appendChild(link);

  // Secciones "calientes" que activan el boton al hacer scroll hasta ellas.
  // Se buscan por ID real de seccion de Carrd. Si una de estas secciones no
  // existe todavia en la pagina (ej. cita-pdf1/pdf2 aun no creadas), se ignora
  // sin generar error.
  var idsCalientes = ['calificacion', 'cita-pdf1', 'cita-pdf2', 'cita-desde-site', 'cita-desde-faqs'];

  function checkVisibility() {
    // Las anclas de Carrd suelen ser marcadores delgados (casi sin altura),
    // no el contenido visible completo. Por eso usamos una zona amplia
    // alrededor del ancla (2500px arriba y abajo) en vez de exigir que el
    // propio marcador este exactamente dentro del viewport.
    var margen = 2500;
    var visible = idsCalientes.some(function(id) {
      // Buscamos por id="..." o por name="..." (Carrd a veces usa uno u otro
      // para las anclas de sus Secciones).
      var el = document.getElementById(id) || document.getElementsByName(id)[0];
      if (!el) return false;
      var rect = el.getBoundingClientRect();
      return rect.top < window.innerHeight + margen && rect.top > -margen;
    });
    link.classList.toggle('visible', visible);
  }

  // Ayuda de diagnostico: si NINGUNA de las secciones calientes se encuentra
  // en la pagina, lo avisamos en la consola para poder revisarlo facil.
  setTimeout(function() {
    var ningunaEncontrada = idsCalientes.every(function(id) {
      return !document.getElementById(id) && !document.getElementsByName(id)[0];
    });
    if (ningunaEncontrada) {
      console.warn('[MAXX WhatsApp floater] Ninguna de las secciones calientes (' + idsCalientes.join(', ') + ') se encontro en la pagina por id ni por name.');
    }
  }, 1500);

  window.addEventListener('scroll', checkVisibility, { passive: true });
  window.addEventListener('resize', checkVisibility);
  checkVisibility();
})();
