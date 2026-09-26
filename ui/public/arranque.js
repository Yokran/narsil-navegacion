// Cosmos de la pantalla de arranque, en reposo. Misma semilla siempre: las partículas caen en
// el mismo sitio en el lanzador y en la interfaz, y el ojo no ve dos pantallas sino una.
// Se ejecuta en cuanto se analiza (no espera a React ni a `load`): el lienzo ya está pintado
// en el primer fotograma.
(function () {
  var c = document.getElementById('arranque-cosmos');
  if (!c) return;
  var x = c.getContext('2d');
  function pintar() {
    var d = Math.min(window.devicePixelRatio || 1, 2), w = c.clientWidth, h = c.clientHeight;
    c.width = Math.max(1, w * d); c.height = Math.max(1, h * d); x.setTransform(d, 0, 0, d, 0, 0);
    x.clearRect(0, 0, w, h);
    var m = Math.max(w, h), f = x.createRadialGradient(w * .32, h * .42, 0, w * .32, h * .42, m * .62);
    f.addColorStop(0, 'rgba(40,50,89,.5)'); f.addColorStop(.55, 'rgba(20,27,46,.24)'); f.addColorStop(1, 'rgba(9,13,24,0)');
    x.fillStyle = f; x.fillRect(0, 0, w, h);
    var k = x.createRadialGradient(w * .7, h * .56, 0, w * .7, h * .56, m * .5);
    k.addColorStop(0, 'rgba(159,106,87,.3)'); k.addColorStop(.5, 'rgba(120,78,64,.11)'); k.addColorStop(1, 'rgba(9,13,24,0)');
    x.fillStyle = k; x.fillRect(0, 0, w, h);
    var s = 7; function r() { s = (s * 16807) % 2147483647; return s / 2147483647; }
    for (var i = 0; i < 150; i++) {
      var b = r() * .55 + .2, cal = r() < .28;
      x.beginPath(); x.arc(r() * w, r() * h, r() * 1.7 + .35, 0, Math.PI * 2);
      x.fillStyle = cal ? 'rgba(222,193,183,' + b + ')' : 'rgba(196,210,236,' + (b * .72) + ')'; x.fill();
    }
  }
  pintar();
  window.addEventListener('resize', pintar);
})();
