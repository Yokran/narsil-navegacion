"""Validación de nombres en TODAS las rutas que escriben en disco.

El preview validaba en unas rutas y en otras no. Las tres que faltaban —`rename_profile`,
`save_template_from_profile` y `delete_template`— metían en una ruta de fichero lo que llegara
por la URL: un `%2e%2e` bien puesto salía de `profiles/` y se llevaba el runtime entero
(extensión Collector, plantilla base, navegador).

Se prueban las RUTAS, no la función de validar. El agujero nunca estuvo en la función.
"""
from __future__ import annotations

import pytest

# `%2e%2e` es `..` codificado: llega hasta el manejador tal cual, mientras que un `..` literal
# lo normaliza el cliente HTTP antes de salir y nunca se probaría lo que se quiere probar.
PUNTOS = "%2e%2e"
HOSTILES = [PUNTOS, "%2e", "%2e%2e%2e", "-perfil", " espacio-delante"]


def test_borrar_perfil_rechaza_nombre_hostil(cliente, runtime_limpio):
    assert cliente.delete(f"/api/profiles/{PUNTOS}").status_code == 400


def test_renombrar_rechaza_el_nombre_de_la_url(cliente, runtime_limpio):
    """El de la URL: `PATCH /api/profiles/%2e%2e` renombraba directorios fuera de profiles/."""
    r = cliente.patch(f"/api/profiles/{PUNTOS}", json={"name": "destino_valido"})
    assert r.status_code == 400, r.text


def test_renombrar_rechaza_el_nombre_nuevo(cliente, runtime_limpio):
    r = cliente.patch("/api/profiles/origen_valido", json={"name": ".."})
    assert r.status_code == 400, r.text


def test_guardar_plantilla_rechaza_el_perfil_origen(cliente, runtime_limpio):
    r = cliente.post(f"/api/profiles/templates/save-from/{PUNTOS}",
                     json={"template_name": "plantilla_valida"})
    assert r.status_code == 400, r.text


def test_guardar_plantilla_rechaza_el_nombre_de_plantilla(cliente, runtime_limpio):
    r = cliente.post("/api/profiles/templates/save-from/perfil_valido",
                     json={"template_name": "../../base_browser"})
    assert r.status_code == 400, r.text


def test_borrar_plantilla_rechaza_nombre_hostil(cliente, runtime_limpio):
    assert cliente.delete(f"/api/profiles/templates/{PUNTOS}").status_code == 400


def test_avatar_y_meta_tambien_validan(cliente, runtime_limpio):
    assert cliente.get(f"/api/profiles/{PUNTOS}/avatar").status_code == 400
    assert cliente.get(f"/api/profiles/{PUNTOS}/meta").status_code == 400
    r = cliente.post(f"/api/profiles/{PUNTOS}/meta", json={"category": "OSINT"})
    assert r.status_code == 400


@pytest.mark.parametrize("nombre", HOSTILES)
def test_ninguna_ruta_mutante_acepta_un_nombre_hostil(cliente, runtime_limpio, nombre):
    """Barrido: ninguna de las rutas que tocan disco puede devolver 2xx con estos nombres."""
    respuestas = [
        cliente.delete(f"/api/profiles/{nombre}"),
        cliente.patch(f"/api/profiles/{nombre}", json={"name": "valido"}),
        cliente.post(f"/api/profiles/{nombre}/open", json={}),
        cliente.post(f"/api/profiles/{nombre}/meta", json={"category": ""}),
        cliente.delete(f"/api/profiles/templates/{nombre}"),
        cliente.post(f"/api/profiles/templates/save-from/{nombre}", json={"template_name": "t"}),
    ]
    for r in respuestas:
        assert r.status_code >= 400, f"{r.request.method} {r.request.url} devolvió {r.status_code}"


def test_la_plantilla_base_esta_protegida(cliente, runtime_limpio):
    """`narsil-base` no se borra ni se sobrescribe: es de la app, no del operador."""
    assert cliente.delete("/api/profiles/templates/narsil-base").status_code == 403
    assert (runtime_limpio.templates_dir / "narsil-base").exists()


def test_el_runtime_sobrevive_a_todo_lo_anterior(cliente, runtime_limpio):
    """La jaula: después de la tanda hostil, el runtime sigue entero.

    Es la comprobación que de verdad importa. Un 400 bonito con el directorio borrado detrás
    no sería una defensa, sería un epitafio.
    """
    for nombre in HOSTILES + ["%2e%2e%2f%2e%2e%2fextensions", "%2e%2e%5c%2e%2e%5cextensions"]:
        cliente.delete(f"/api/profiles/templates/{nombre}")
        cliente.delete(f"/api/profiles/{nombre}")
        cliente.post(f"/api/profiles/templates/save-from/{nombre}", json={"template_name": nombre})

    assert (runtime_limpio.templates_dir / "narsil-base" / "user.js").exists()
    assert (runtime_limpio.extensions_dir / "narsil-intel@narsil.local" / "manifest.json").exists()
    assert runtime_limpio.extensions_dir.exists()
    # Y nada nuevo se ha colado en la raíz de datos.
    inesperados = {p.name for p in runtime_limpio.data.iterdir()} - {
        "runtime", "profiles", "logs", "settings"}
    assert not inesperados, f"Ficheros creados fuera de sitio: {inesperados}"
