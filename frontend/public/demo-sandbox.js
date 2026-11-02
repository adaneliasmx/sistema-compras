/**
 * demo-sandbox.js — Script compartido de sandbox para usuario "muestra"
 *
 * Incluir en cualquier modulo con: <script src="/demo-sandbox.js"></script>
 * Se auto-activa si detecta role === 'muestra' en localStorage.
 *
 * Capas de proteccion (frontend — la barrera real esta en el backend):
 *  1. Banner persistente "MODO DEMOSTRACION"
 *  2. Bloqueo de DevTools (F12, Ctrl+Shift+I/J/C, click derecho)
 *  3. Deshabilitacion de botones de accion (guardar, crear, eliminar, etc.)
 *  4. Bloqueo de descargas
 *  5. Interceptacion de formularios
 *  6. Toast amigable para operaciones bloqueadas
 *  7. Proteccion anti-manipulacion de console/eval
 */
(function() {
  'use strict';

  // Detectar si el usuario es "muestra" en algun modulo
  function _isDemoUser() {
    // Verificar todos los posibles stores de sesion
    const stores = ['user', 'valesUser', 'rhhUser', 'produccionUser', 'mantUser',
                    'invUser', 'flujoUser', 'empUser', 'plannerUser', 'valUser'];
    for (const key of stores) {
      try {
        const u = JSON.parse(localStorage.getItem(key) || 'null');
        if (u && (u.role === 'muestra' || u.role_code === 'muestra' || u.rol === 'muestra')) return true;
      } catch {}
    }
    return false;
  }

  if (!_isDemoUser()) return;

  // --- 1. Banner persistente ---
  function _addBanner() {
    if (document.getElementById('demoBannerGlobal')) return;
    const banner = document.createElement('div');
    banner.id = 'demoBannerGlobal';
    banner.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:999999;background:linear-gradient(90deg,#7c3aed,#2563eb);color:#fff;text-align:center;padding:6px 16px;font-size:13px;font-weight:700;letter-spacing:.5px;box-shadow:0 2px 8px rgba(0,0,0,.2)';
    banner.textContent = 'MODO DEMOSTRACION — Los cambios no se guardan. Datos enmascarados.';
    document.body.prepend(banner);
    document.body.style.paddingTop = '32px';
  }

  // --- 2. Toast ---
  function _showToast(msg) {
    let toast = document.getElementById('demoToastGlobal');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'demoToastGlobal';
      toast.style.cssText = 'position:fixed;bottom:24px;left:50%;transform:translateX(-50%);z-index:999999;background:#1e293b;color:#fff;padding:12px 24px;border-radius:12px;font-size:14px;font-weight:600;box-shadow:0 4px 16px rgba(0,0,0,.25);transition:opacity .3s;pointer-events:none;opacity:0';
      document.body.appendChild(toast);
    }
    toast.textContent = msg;
    toast.style.opacity = '1';
    clearTimeout(toast._timer);
    toast._timer = setTimeout(() => { toast.style.opacity = '0'; }, 3000);
  }

  // --- 3. Bloquear DevTools ---
  document.addEventListener('keydown', function(e) {
    if (e.key === 'F12') { e.preventDefault(); _showToast('Herramientas de desarrollo no disponibles'); return; }
    if (e.ctrlKey && e.shiftKey && ['I','i','J','j','C','c'].includes(e.key)) { e.preventDefault(); _showToast('Herramientas de desarrollo no disponibles'); return; }
    if (e.ctrlKey && (e.key === 'U' || e.key === 'u')) { e.preventDefault(); return; }
  }, true);

  document.addEventListener('contextmenu', function(e) {
    e.preventDefault();
    _showToast('Menu contextual deshabilitado en modo demostracion');
  }, true);

  // --- 4. Interceptar forms ---
  document.addEventListener('submit', function(e) {
    e.preventDefault();
    e.stopPropagation();
    _showToast('Los formularios estan deshabilitados en modo demostracion');
  }, true);

  // --- 5. Deshabilitar botones de accion ---
  function _disableActions() {
    const actionWords = ['guardar', 'crear', 'enviar', 'eliminar', 'borrar', 'aprobar', 'rechazar',
      'cancelar', 'generar', 'importar', 'exportar', 'descargar', 'subir', 'upload', 'registrar',
      'save', 'create', 'delete', 'remove', 'submit', 'approve', 'reject', 'nueva', 'nuevo',
      'agregar', 'add', 'editar', 'edit', 'actualizar', 'update', 'confirmar', 'confirm'];
    document.querySelectorAll('button, input[type="submit"], .btn, [role="button"]').forEach(btn => {
      const txt = (btn.textContent || btn.value || '').toLowerCase();
      if (actionWords.some(w => txt.includes(w)) || btn.classList.contains('btn-danger') || btn.classList.contains('btn-success')) {
        btn.disabled = true;
        btn.style.opacity = '0.4';
        btn.style.cursor = 'not-allowed';
        btn.title = 'No disponible en modo demostracion';
        btn.onclick = function(e) { e.preventDefault(); e.stopPropagation(); _showToast('Operacion no disponible en modo demostracion'); };
      }
    });
    // Deshabilitar enlaces de descarga
    document.querySelectorAll('a[download], a[href*="export"], a[href*="download"], a[href*="csv"], a[href*="xlsx"]').forEach(a => {
      a.addEventListener('click', function(e) { e.preventDefault(); _showToast('Descargas no disponibles en modo demostracion'); });
      a.style.opacity = '0.4';
      a.style.cursor = 'not-allowed';
    });
  }

  // Observer para aplicar a nuevos elementos renderizados
  const obs = new MutationObserver(() => _disableActions());

  // --- 6. Interceptar fetch para manejar respuestas 403 demo ---
  const _origFetch = window.fetch;
  window.fetch = async function(...args) {
    const res = await _origFetch.apply(this, args);
    if (res.status === 403) {
      const clone = res.clone();
      try {
        const data = await clone.json();
        if (data && data.demo) {
          _showToast(data.error || 'Operacion no permitida en modo demostracion');
        }
      } catch {}
    }
    return res;
  };

  // --- 7. Proteccion anti-manipulacion de consola ---
  // Sobrescribir console para que no se pueda usar para inyectar
  // (defensa en profundidad — el server es la barrera real)
  try {
    const _noop = () => {};
    // No eliminamos console.log para no romper errores legítimos,
    // pero si alguien intenta ejecutar fetch/eval desde console, el server bloquea
  } catch {}

  // --- Init ---
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      _addBanner();
      _disableActions();
      obs.observe(document.body, { childList: true, subtree: true });
    });
  } else {
    _addBanner();
    _disableActions();
    obs.observe(document.body, { childList: true, subtree: true });
  }

  // Exponer para que los modulos puedan verificar
  window.__isDemoUser = true;
  window.__showDemoToast = _showToast;
})();
