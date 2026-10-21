(function() {
  if (window.__maxxMenuCargado) return;
  window.__maxxMenuCargado = true;

  // ===== Estructura del menu (6 titulos) =====
  // href: ancla de la pagina. faq: abre el buscador de FAQs en ese tema.
  var MENU = [
    { t: '¿Cuánto necesitas para el Retiro?', href: 'calificacion' },
    { t: 'Plan Personal de Retiro', href: 'secc-ppr', hijos: [
      { t: '¿Qué es un PPR - video?', href: 'video-myt-ppr' },
      { t: 'Descripción', href: 'scrollpoint-11' },
      { t: 'Beneficios', href: 'scrollpoint-12' },
      { t: 'FAQs del PPR', faq: 'ppr' }
    ]},
    { t: 'Programa Digital de Finanzas Personales', href: 'prog-edu-fin-maxx', hijos: [
      { t: 'Módulos del Programa', href: 'scrollpoint-modulos' },
      { t: 'Tabla Contenido Módulos', href: 'tabla-modulos' },
      { t: 'Beneficios para Entidades', href: 'scrollpoint-ben-progr-entidad' },
      { t: 'Condiciones de Participación', href: 'condiciones-participacion' },
      { t: 'FAQs del Programa', faq: 'programa' }
    ]},
    { t: 'Referenciadores - Lead Generators', href: 'sub-home-referidores' },
    { t: 'Contacto MAXX', mailto: 'contacto@maxx.mx' },
    { t: 'Aviso de Privacidad', href: 'aviso' }
  ];

  var css = document.createElement('style');
  css.textContent = `
    #maxx-menu-btn {
      position: fixed; top: 14px; right: 18px; z-index: 9998;
      width: 46px; height: 46px; border-radius: 10px; border: none; cursor: pointer;
      background: #042C53; box-shadow: 0 2px 10px rgba(0,0,0,0.3);
      display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 5px;
      padding: 0;
    }
    #maxx-menu-btn span { display: block; width: 24px; height: 3px; border-radius: 2px; background: #FFF; }
    #maxx-menu-btn:hover { background: #185FA5; }
    #maxx-menu-fondo {
      position: fixed; inset: 0; z-index: 10000; background: rgba(4,44,83,0.55);
      opacity: 0; pointer-events: none; transition: opacity .25s;
    }
    #maxx-menu-fondo.abierto { opacity: 1; pointer-events: auto; }
    #maxx-menu-panel {
      position: fixed; top: 0; right: 0; bottom: 0; z-index: 10001;
      width: 340px; max-width: 88vw; background: #042C53; color: #FFF;
      transform: translateX(100%); transition: transform .28s ease;
      display: flex; flex-direction: column; overflow-y: auto;
      font-family: 'Roboto', Arial, sans-serif; box-shadow: -6px 0 24px rgba(0,0,0,0.35);
    }
    #maxx-menu-panel.abierto { transform: translateX(0); }
    #maxx-menu-cab { display: flex; justify-content: space-between; align-items: center; padding: 16px 18px 10px 20px; flex-shrink: 0; }
    #maxx-menu-cab b { font-size: 13px; letter-spacing: 2px; color: #639922; text-transform: uppercase; }
    #maxx-menu-cerrar { background: none; border: none; color: #FFF; font-size: 24px; cursor: pointer; line-height: 1; padding: 4px 8px; }
    #maxx-menu-lista { list-style: none; margin: 0; padding: 4px 0 24px 0; }
    .maxx-menu-fila { display: flex; align-items: stretch; border-bottom: 1px solid rgba(255,255,255,0.12); }
    .maxx-menu-enlace {
      flex: 1; display: block; text-align: left; background: none; border: none; color: #FFF; cursor: pointer;
      padding: 15px 20px; font-family: inherit; font-size: 15.5px; font-weight: 500; line-height: 1.3; text-decoration: none;
    }
    .maxx-menu-enlace:hover { background: #185FA5; }
    .maxx-menu-flecha {
      width: 54px; flex-shrink: 0; background: none; border: none; border-left: 1px solid rgba(255,255,255,0.12);
      color: #FFF; cursor: pointer; font-size: 14px; transition: transform .2s;
    }
    .maxx-menu-flecha:hover { background: #185FA5; }
    .maxx-menu-grupo.abierto .maxx-menu-flecha { transform: rotate(180deg); }
    .maxx-menu-hijos { list-style: none; margin: 0; padding: 0; display: none; background: rgba(0,0,0,0.18); }
    .maxx-menu-grupo.abierto .maxx-menu-hijos { display: block; }
    .maxx-menu-hijos .maxx-menu-enlace { font-size: 14px; font-weight: 400; padding: 12px 20px 12px 36px; position: relative; }
    .maxx-menu-hijos .maxx-menu-enlace:before { content: ''; position: absolute; left: 20px; top: 50%; width: 6px; height: 6px; margin-top: -3px; border-radius: 50%; background: #639922; }
    .maxx-menu-hijos li { border-top: 1px solid rgba(255,255,255,0.08); }
  `;
  document.head.appendChild(css);

  // ===== Boton hamburguesa =====
  var btn = document.createElement('button');
  btn.id = 'maxx-menu-btn';
  btn.type = 'button';
  btn.setAttribute('aria-label', 'Abrir menú');
  btn.setAttribute('aria-expanded', 'false');
  btn.innerHTML = '<span></span><span></span><span></span>';
  document.body.appendChild(btn);

  var fondo = document.createElement('div');
  fondo.id = 'maxx-menu-fondo';
  document.body.appendChild(fondo);

  var panel = document.createElement('nav');
  panel.id = 'maxx-menu-panel';
  panel.setAttribute('aria-label', 'Menú principal');
  panel.innerHTML = '<div id="maxx-menu-cab"><b>Menú</b><button id="maxx-menu-cerrar" type="button" aria-label="Cerrar menú">✕</button></div><ul id="maxx-menu-lista"></ul>';
  document.body.appendChild(panel);

  var lista = panel.querySelector('#maxx-menu-lista');

  function abrir() {
    panel.classList.add('abierto'); fondo.classList.add('abierto');
    btn.setAttribute('aria-expanded', 'true');
  }
  function cerrar() {
    panel.classList.remove('abierto'); fondo.classList.remove('abierto');
    btn.setAttribute('aria-expanded', 'false');
  }

  // Busca el destino: Carrd puede ponerle el nombre como id o como data-scroll-id
  function buscar(nombre) {
    return document.getElementById(nombre) ||
      document.querySelector('[data-scroll-id="' + nombre + '"]') ||
      document.querySelector('[name="' + nombre + '"]');
  }

  function ir(item) {
    cerrar();
    if (item.mailto) { window.location.href = 'mailto:' + item.mailto; return; }
    if (item.faq) {
      setTimeout(function() {
        if (typeof window.maxxFaqSearchOpen === 'function') window.maxxFaqSearchOpen(item.faq);
        else window.location.hash = '#faqs-' + item.faq;
      }, 280);
      return;
    }
    setTimeout(function() {
      var el = buscar(item.href);
      if (el) {
        var y = el.getBoundingClientRect().top + window.pageYOffset;
        window.scrollTo({ top: Math.max(0, y), behavior: 'smooth' });
        try { history.replaceState(null, '', '#' + item.href); } catch (e) {}
      } else {
        window.location.hash = '#' + item.href;
      }
    }, 280);
  }

  function crearEnlace(item) {
    var a = document.createElement('a');
    a.className = 'maxx-menu-enlace';
    a.textContent = item.t;
    a.href = item.mailto ? ('mailto:' + item.mailto) : item.faq ? ('#faqs-' + item.faq) : ('#' + item.href);
    a.addEventListener('click', function(ev) { ev.preventDefault(); ir(item); });
    return a;
  }

  MENU.forEach(function(item) {
    var li = document.createElement('li');
    var fila = document.createElement('div');
    fila.className = 'maxx-menu-fila';
    fila.appendChild(crearEnlace(item));
    li.appendChild(fila);
    if (item.hijos) {
      li.className = 'maxx-menu-grupo';
      var fl = document.createElement('button');
      fl.type = 'button'; fl.className = 'maxx-menu-flecha';
      fl.setAttribute('aria-label', 'Mostrar opciones de ' + item.t);
      fl.innerHTML = '▼';
      fl.addEventListener('click', function() {
        var abierto = li.classList.toggle('abierto');
        fl.setAttribute('aria-expanded', abierto ? 'true' : 'false');
      });
      fila.appendChild(fl);
      var ul = document.createElement('ul');
      ul.className = 'maxx-menu-hijos';
      item.hijos.forEach(function(h) {
        var l2 = document.createElement('li');
        l2.appendChild(crearEnlace(h));
        ul.appendChild(l2);
      });
      li.appendChild(ul);
    }
    lista.appendChild(li);
  });

  btn.addEventListener('click', function() {
    if (panel.classList.contains('abierto')) cerrar(); else abrir();
  });
  fondo.addEventListener('click', cerrar);
  panel.querySelector('#maxx-menu-cerrar').addEventListener('click', cerrar);
  document.addEventListener('keydown', function(ev) { if (ev.key === 'Escape') cerrar(); });
})();
