// Konfigurasi URL Backend Anda
const API_URL = "https://scanner-pt-dsn-new.vercel.app/api/scans";

// State Data Global
let allData = [];
let scannedCodesSet = new Set();
let masterDB = {};

// State Aplikasi
let isScanning = false,
  currentCam = "environment",
  lastErrorTime = 0,
  isTorchOn = false;
let isHD = true,
  streamTrack = null,
  scanLoopFrame = null,
  audioCtx = null,
  zxingReader = null;

let scanStartTime = 0;
let scanTimeoutTriggered = false;

const video = document.getElementById("videoElement");
const Toast = Swal.mixin({
  toast: true,
  position: "top-end",
  showConfirmButton: false,
  timer: 2000,
  background: "rgba(15, 23, 42, 0.95)",
  color: "#fff",
});

// PULL TO REFRESH LOGIC
let touchStartY = 0;
const pullIndicator = document.getElementById("pullIndicator");
window.addEventListener(
  "touchstart",
  function (e) {
    if (
      document.getElementById("view-scan").classList.contains("active") &&
      window.scrollY === 0
    )
      touchStartY = e.touches[0].clientY;
    else touchStartY = 0;
  },
  { passive: true },
);
window.addEventListener(
  "touchmove",
  function (e) {
    if (
      touchStartY > 0 &&
      document.getElementById("view-scan").classList.contains("active")
    ) {
      let y = e.touches[0].clientY;
      if (y - touchStartY > 80) pullIndicator.style.opacity = "1";
      if (y - touchStartY > 160) {
        touchStartY = 0;
        pullIndicator.style.opacity = "0";
        Swal.fire({
          title: "Menyegarkan Kamera...",
          timer: 1000,
          background: "rgba(15, 23, 42, 0.95)",
          color: "#fff",
          didOpen: () => {
            Swal.showLoading();
          },
        }).then(() => location.reload());
      }
    }
  },
  { passive: true },
);
window.addEventListener("touchend", function () {
  pullIndicator.style.opacity = "0";
});

function switchPage(pageId, navElement) {
  if (pageId !== "view-scan" && isScanning) stopCamera();
  document
    .querySelectorAll(".view-page")
    .forEach((page) => page.classList.remove("active"));
  document
    .querySelectorAll(".nav-item")
    .forEach((item) => item.classList.remove("active"));
  document.getElementById(pageId).classList.add("active");
  navElement.classList.add("active");
  if (pageId === "view-session") renderToday();
  if (pageId === "view-database") renderDatabase();
}

let nativeDetector = null;
if ("BarcodeDetector" in window) {
  try {
    nativeDetector = new BarcodeDetector();
  } catch (e) {
    nativeDetector = null;
  }
}

function getZXingHints() {
  try {
    const hints = new Map();
    hints.set(ZXing.DecodeHintType.TRY_HARDER, true);
    hints.set(ZXing.DecodeHintType.POSSIBLE_FORMATS, [
      ZXing.BarcodeFormat.CODE_128,
      ZXing.BarcodeFormat.CODE_39,
      ZXing.BarcodeFormat.CODE_93,
      ZXing.BarcodeFormat.ITF,
      ZXing.BarcodeFormat.CODABAR,
      ZXing.BarcodeFormat.EAN_13,
      ZXing.BarcodeFormat.EAN_8,
      ZXing.BarcodeFormat.UPC_A,
      ZXing.BarcodeFormat.UPC_E,
      ZXing.BarcodeFormat.QR_CODE,
    ]);
    return hints;
  } catch (e) {
    return undefined;
  }
}

function initAudio() {
  if (!audioCtx)
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  if (audioCtx.state === "suspended") audioCtx.resume();
}

// AUTO PARSE DYNAMIC
function autoParseDynamic(code) {
  const prefix = code.substring(0, 8);
  if (masterDB[prefix]) {
    let data = { ...masterDB[prefix] };
    data.kode = code;
    return data;
  }
  if (code.startsWith("111")) {
    if (code.includes("1916") || code.includes("28814"))
      return {
        jenisBarcode: "Barcode 3",
        panjang: 280,
        lebar: 15,
        potongan: 24,
        persegi: "10.08",
        log: "FFP BX003187",
        bundle: "11",
      };
    if (code.includes("8081"))
      return {
        jenisBarcode: "Barcode 3",
        panjang: 300,
        lebar: 13,
        potongan: 24,
        persegi: "9.36",
        log: "FFP BX004129",
        bundle: "9",
      };
  }
  if (code.startsWith("159") || code.startsWith("10"))
    return {
      jenisBarcode: "Barcode 2",
      panjang: 305,
      lebar: 14,
      potongan: 24,
      persegi: "10.25",
      log: "10",
      bundle: "014085",
    };
  return null;
}

function showFullManualInputPrompt() {
  stopCamera();
  Swal.fire({
    title: "Input Data Darurat",
    html: `
            <div style="font-size:0.85rem; color:#8b9bb4; margin-bottom:15px; text-align:left; line-height:1.4;">
              Sistem kesulitan membaca lekukan atau tinta pudar.<br>
              Silakan masukkan dimensinya di bawah ini.<br>Sistem akan membuat Serial Otomatis.
            </div>
            <select id="t-jenis" class="swal2-select">
              <option value="Barcode 3">Ini Barcode 3</option>
              <option value="Barcode 2">Ini Barcode 2</option>
              <option value="Barcode 1">Ini Barcode 1</option>
            </select>
            <input id="t-log" class="swal2-input" placeholder="LOG (Cth: 21270A)">
            <input id="t-bundle" class="swal2-input" placeholder="BUNDLE (Cth: 001)">
            <input id="t-p" type="number" class="swal2-input" placeholder="Panjang (Cth: 300)">
            <input id="t-l" type="number" step="0.1" class="swal2-input" placeholder="Lebar (Cth: 13.5)">
            <input id="t-pot" type="number" class="swal2-input" placeholder="Potongan (Cth: 24)">
          `,
    customClass: { popup: "swal-dark-custom" },
    showCancelButton: true,
    confirmButtonText:
      '<i class="fas fa-save" style="margin-right:5px;"></i> Simpan',
    cancelButtonText: "Batal",
    preConfirm: () => {
      const j = document.getElementById("t-jenis").value;
      const logVal = document.getElementById("t-log").value.trim();
      const bundleVal = document.getElementById("t-bundle").value.trim();
      const p = parseFloat(document.getElementById("t-p").value);
      const l = parseFloat(document.getElementById("t-l").value);
      const pot = parseInt(document.getElementById("t-pot").value);

      if (!logVal || !bundleVal || isNaN(p) || isNaN(l) || isNaN(pot)) {
        Swal.showValidationMessage(
          "Semua kolom (Log, Bundle, & dimensi) wajib diisi dengan benar!",
        );
        return false;
      }

      const randomCode = "MNL-" + Math.floor(100000 + Math.random() * 900000);
      return {
        kode: randomCode,
        jenisBarcode: j,
        log: logVal,
        bundle: bundleVal,
        panjang: p,
        lebar: l,
        potongan: pot,
        persegi: ((p * l * pot) / 10000).toFixed(2),
      };
    },
  }).then((res) => {
    if (res.isConfirmed) {
      const data = res.value;
      scannedCodesSet.add(data.kode);
      simpanData(data.kode, "MANUAL_TIMEOUT", data);
    }
    if (document.getElementById("view-scan").classList.contains("active"))
      setTimeout(toggleScan, 300);
  });
}

function promptNewMasterData(code, format) {
  if (isScanning) stopCamera();
  let predictedType =
    code.startsWith("15") || code.startsWith("10")
      ? "Barcode 2"
      : code.startsWith("86")
        ? "Barcode 1"
        : "Barcode 3";

  Swal.fire({
    title: "Master Data Baru!",
    html: `
            <div style="font-size:0.85rem; color:#8b9bb4; margin-bottom:15px; text-align:left; line-height:1.4;">
              Sistem mendeteksi Nomor Barcode yang belum dikenali:
              <b style="color:#ffffff; font-size:1rem; letter-spacing: 0.5px; word-break: break-all; display:block; margin: 8px 0;">${code}</b>
              Silakan masukkan data 1x saja.<br>Sistem akan mengingatnya selamanya.
            </div>
            <select id="m-jenis" class="swal2-select">
              <option value="Barcode 3" ${predictedType === "Barcode 3" ? "selected" : ""}>Ini Barcode 3</option>
              <option value="Barcode 2" ${predictedType === "Barcode 2" ? "selected" : ""}>Ini Barcode 2</option>
              <option value="Barcode 1" ${predictedType === "Barcode 1" ? "selected" : ""}>Ini Barcode 1</option>
            </select>
            <input id="m-log" class="swal2-input" placeholder="LOG (Cth: 21270A)">
            <input id="m-bundle" class="swal2-input" placeholder="BUNDLE (Cth: 001)">
            <input id="m-p" type="number" class="swal2-input" placeholder="Panjang (Cth: 300)">
            <input id="m-l" type="number" step="0.1" class="swal2-input" placeholder="Lebar (Cth: 13.5)">
            <input id="m-pot" type="number" class="swal2-input" placeholder="Potongan (Cth: 24)">
          `,
    customClass: { popup: "swal-dark-custom" },
    showCancelButton: true,
    confirmButtonText:
      '<i class="fas fa-save" style="margin-right:5px;"></i> Simpan',
    cancelButtonText: "Batal",
    preConfirm: () => {
      const j = document.getElementById("m-jenis").value;
      const logVal = document.getElementById("m-log").value.trim();
      const bundleVal = document.getElementById("m-bundle").value.trim();
      const p = parseFloat(document.getElementById("m-p").value);
      const l = parseFloat(document.getElementById("m-l").value);
      const pot = parseInt(document.getElementById("m-pot").value);

      if (!logVal || !bundleVal || isNaN(p) || isNaN(l) || isNaN(pot)) {
        Swal.showValidationMessage(`Semua kolom wajib diisi!`);
        return false;
      }
      return {
        jenisBarcode: j,
        log: logVal,
        bundle: bundleVal,
        panjang: p,
        lebar: l,
        potongan: pot,
        persegi: ((p * l * pot) / 10000).toFixed(2),
      };
    },
  }).then((res) => {
    if (res.isConfirmed) {
      const data = res.value;
      data.kode = code;
      masterDB[code] = data;
      masterDB[code.substring(0, 8)] = data;

      localStorage.setItem("SCMMasterDB", JSON.stringify(masterDB));
      scannedCodesSet.add(code);
      simpanData(code, format, data);
    }
    if (document.getElementById("view-scan").classList.contains("active"))
      setTimeout(toggleScan, 300);
  });
}

function parseBarcode1(raw) {
  let cleanRaw = raw.trim().toUpperCase();
  if (cleanRaw.startsWith("86") && cleanRaw.length >= 24) {
    try {
      const p_str = cleanRaw.slice(-4),
        w_str = cleanRaw.slice(-9, -4),
        l_str = cleanRaw.slice(-12, -9),
        ext_str = cleanRaw.slice(-16, -12),
        prefix = cleanRaw.slice(2, -16);

      // Extract LOG (strip leading zeros)
      let logVal = prefix.replace(/^0+/, "");
      if (!logVal) logVal = "-";

      // Extract BUNDLE
      const extNum = parseInt(ext_str, 10);
      let bundleVal = isNaN(extNum)
        ? ext_str
        : extNum.toString().padStart(3, "0");

      const p_indo = parseInt(l_str, 10),
        l_indo = parseInt(w_str, 10) / 10,
        potongan = parseInt(p_str, 10);
      const persegi = (p_indo * l_indo * potongan) / 10000;

      if (!isNaN(p_indo) && !isNaN(l_indo) && !isNaN(potongan))
        return {
          jenisBarcode: "Barcode 1",
          panjang: p_indo,
          lebar: l_indo,
          potongan: potongan,
          persegi: persegi.toFixed(2),
          log: logVal,
          bundle: bundleVal,
        };
    } catch (e) {}
  }
  return null;
}

function processBarcodeDetected(rawCode, format) {
  let code = rawCode
    .trim()
    .toUpperCase()
    .replace(/O/g, "0")
    .replace(/[^A-Z0-9-.\/]/g, "");
  if (code.length < 6) return;

  scanStartTime = Date.now();
  scanTimeoutTriggered = false;

  if (scannedCodesSet.has(code)) {
    const now = Date.now();
    if (now - lastErrorTime > 2000) {
      triggerErrorFeedback();
      Toast.fire({ icon: "error", title: "Sudah di-scan!" });
      lastErrorTime = now;
    }
    return;
  }

  if (masterDB[code]) {
    scannedCodesSet.add(code);
    simpanData(code, format, masterDB[code]);
    return;
  }
  let b1Data = parseBarcode1(code);
  if (b1Data) {
    scannedCodesSet.add(code);
    simpanData(code, format, b1Data);
    return;
  }

  let b23Data = autoParseDynamic(code);
  if (b23Data) {
    scannedCodesSet.add(code);
    simpanData(code, format, b23Data);
    return;
  }

  promptNewMasterData(code, format);
}

function stopCamera() {
  isScanning = false;
  isTorchOn = false;
  document.getElementById("btnTorch").classList.remove("active");
  cancelAnimationFrame(scanLoopFrame);
  if (streamTrack) {
    streamTrack.stop();
    streamTrack = null;
  }
  if (video.srcObject) {
    video.srcObject.getTracks().forEach((t) => t.stop());
    video.srcObject = null;
  }
  if (zxingReader) {
    zxingReader.reset();
  }
  video.style.display = "none";
  document.getElementById("laser").style.display = "none";
  document.getElementById("targetBox").style.display = "none";
  document.getElementById("placeholderMsg").style.display = "flex";
  const btn = document.getElementById("btnAction");
  btn.innerHTML =
    '<i class="fas fa-play" style="margin-right: 8px;"></i> MULAI';
  btn.classList.remove("stop");
}

async function getOptimizedStream(requestHD, camType) {
  const mode = camType === "environment" ? { ideal: "environment" } : "user";
  let stream = null;

  if (requestHD) {
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: mode,
          width: { ideal: 1280 },
          height: { ideal: 720 },
          frameRate: { ideal: 60, min: 30 },
        },
      });
      return stream;
    } catch (e) {}
  } else {
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: mode,
          width: { ideal: 640 },
          height: { ideal: 480 },
          frameRate: { ideal: 60, min: 30 },
        },
      });
      return stream;
    } catch (e) {}
  }
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: mode },
    });
    return stream;
  } catch (e) {}
  return await navigator.mediaDevices.getUserMedia({ video: true });
}

async function toggleScan() {
  if (isScanning) {
    stopCamera();
    return;
  }
  initAudio();
  document.getElementById("placeholderMsg").style.display = "none";
  video.style.display = "block";
  document.getElementById("laser").style.display = "block";
  document.getElementById("targetBox").style.display = "block";
  const btn = document.getElementById("btnAction");
  btn.innerHTML = '<i class="fas fa-stop" style="margin-right: 8px;"></i> STOP';
  btn.classList.add("stop");
  isScanning = true;

  scanStartTime = Date.now();
  scanTimeoutTriggered = false;

  try {
    let stream = await getOptimizedStream(isHD, currentCam);
    video.srcObject = stream;
    streamTrack = stream.getVideoTracks()[0];

    try {
      const caps = streamTrack.getCapabilities();
      let advancedConstraints = {};
      let applyConstraints = false;

      if (caps.focusMode && caps.focusMode.includes("macro")) {
        advancedConstraints.focusMode = "macro";
        applyConstraints = true;
      } else if (caps.focusMode && caps.focusMode.includes("continuous")) {
        advancedConstraints.focusMode = "continuous";
        applyConstraints = true;
      }

      if (caps.zoom) {
        advancedConstraints.zoom = Math.min(
          caps.zoom.max,
          Math.max(caps.zoom.min, 1.5),
        );
        applyConstraints = true;
      }
      if (applyConstraints) {
        await streamTrack.applyConstraints({
          advanced: [advancedConstraints],
        });
      }
    } catch (e) {}

    await new Promise((resolve) => {
      video.onloadedmetadata = () => resolve();
    });
    await video.play();

    let lastScanTime = 0;

    if (nativeDetector) {
      const detectLoop = async (timestamp) => {
        if (!isScanning) return;
        if (timestamp - lastScanTime >= 60) {
          lastScanTime = timestamp;

          if (!scanTimeoutTriggered && Date.now() - scanStartTime > 12000) {
            scanTimeoutTriggered = true;
            showFullManualInputPrompt();
            return;
          }
          try {
            const barcodes = await nativeDetector.detect(video);
            if (barcodes.length > 0)
              processBarcodeDetected(
                barcodes[0].rawValue,
                barcodes[0].format.toUpperCase(),
              );
          } catch (e) {}
        }
        scanLoopFrame = requestAnimationFrame(detectLoop);
      };
      scanLoopFrame = requestAnimationFrame(detectLoop);
    } else {
      zxingReader = new ZXing.BrowserMultiFormatReader(getZXingHints());
      zxingReader.timeBetweenDecodingAttempts = isHD ? 200 : 100;
      zxingReader.decodeFromStream(stream, "videoElement", (result, err) => {
        if (!isScanning) return;
        if (!scanTimeoutTriggered && Date.now() - scanStartTime > 12000) {
          scanTimeoutTriggered = true;
          showFullManualInputPrompt();
          return;
        }
        if (result)
          processBarcodeDetected(
            result.getText(),
            result.getBarcodeFormat
              ? result.getBarcodeFormat().toString()
              : "UNKNOWN",
          );
      });
    }
  } catch (err) {
    stopCamera();
    Toast.fire({
      icon: "error",
      title: "Kamera ditolak oleh Browser/HP!",
    });
  }
}

async function toggleResolution() {
  isHD = !isHD;
  document.getElementById("resText").innerText = isHD ? "HD" : "SD";
  document.getElementById("btnRes").classList.toggle("active", !isHD);
  let msg = isHD
    ? "Mode HD Aktif (Ketajaman Tinggi)"
    : "Mode SD Aktif (Performa Cepat)";
  Toast.fire({ icon: "info", title: msg });
  if (isScanning) {
    stopCamera();
    setTimeout(toggleScan, 300);
  }
}

async function toggleTorch() {
  if (!isScanning || !streamTrack)
    return Toast.fire({ icon: "warning", title: "Mulai scan dulu!" });
  try {
    const capabilities = streamTrack.getCapabilities();
    if (capabilities.torch) {
      isTorchOn = !isTorchOn;
      await streamTrack.applyConstraints({
        advanced: [{ torch: isTorchOn }],
      });
      document.getElementById("btnTorch").classList.toggle("active", isTorchOn);
    } else {
      Toast.fire({
        icon: "error",
        title: "Senter tidak didukung perangkat",
      });
    }
  } catch (error) {
    Toast.fire({ icon: "error", title: "Akses ditolak" });
  }
}

function switchCamera() {
  currentCam = currentCam === "environment" ? "user" : "environment";
  if (isScanning) {
    stopCamera();
    setTimeout(toggleScan, 300);
  } else {
    Toast.fire({
      icon: "info",
      title: currentCam === "environment" ? "Kamera Belakang" : "Kamera Depan",
    });
  }
}

function triggerFeedback() {
  if (navigator.vibrate) navigator.vibrate([30]);
  if (audioCtx) {
    try {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.type = "square";
      osc.frequency.setValueAtTime(3500, audioCtx.currentTime);
      gain.gain.setValueAtTime(0, audioCtx.currentTime);
      gain.gain.linearRampToValueAtTime(0.5, audioCtx.currentTime + 0.005);
      gain.gain.linearRampToValueAtTime(0, audioCtx.currentTime + 0.04);
      osc.start(audioCtx.currentTime);
      osc.stop(audioCtx.currentTime + 0.04);
    } catch (e) {}
  }
  const box = document.getElementById("targetBox");
  box.style.borderColor = "var(--success)";
  box.style.filter = "drop-shadow(0 0 15px var(--success))";
  setTimeout(() => {
    box.style.borderColor = "#38bdf8";
    box.style.filter = "none";
  }, 150);
}

function triggerErrorFeedback() {
  if (navigator.vibrate) navigator.vibrate([100, 50, 100]);
  if (audioCtx) {
    try {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.type = "sawtooth";
      osc.frequency.setValueAtTime(300, audioCtx.currentTime);
      gain.gain.setValueAtTime(0, audioCtx.currentTime);
      gain.gain.linearRampToValueAtTime(0.5, audioCtx.currentTime + 0.01);
      gain.gain.linearRampToValueAtTime(0, audioCtx.currentTime + 0.15);
      osc.start(audioCtx.currentTime);
      osc.stop(audioCtx.currentTime + 0.15);
    } catch (e) {}
  }
  const box = document.getElementById("targetBox");
  box.style.borderColor = "var(--danger)";
  box.style.filter = "drop-shadow(0 0 15px var(--danger))";
  setTimeout(() => {
    box.style.borderColor = "#38bdf8";
    box.style.filter = "none";
  }, 200);
}

function inputManual() {
  const val = document.getElementById("manualData").value.trim();
  if (!val) return Toast.fire({ icon: "error", title: "Kode kosong!" });
  processBarcodeDetected(val, "MANUAL");
  document.getElementById("manualData").value = "";
}

function simpanData(kode, barcodeFormat, parsedData) {
  const nowDate = new Date();
  const tglHariIni = new Date(
    nowDate.getTime() - nowDate.getTimezoneOffset() * 60000,
  )
    .toISOString()
    .split("T")[0];

  // Memastikan kompabilitas bila ada data lama
  const finalLog = parsedData.log || parsedData.golongan || "-";
  const finalBundle = parsedData.bundle || "-";

  const newData = {
    id: Date.now(),
    scannedAt: Date.now(),
    kode: kode,
    jenis: parsedData.jenisBarcode,
    log: finalLog,
    bundle: finalBundle,
    panjang: parsedData.panjang,
    lebar: parsedData.lebar,
    potongan: parsedData.potongan,
    persegi: parsedData.persegi,
    tanggal: tglHariIni,
    jam: nowDate.toTimeString().split(" ")[0],
    format: barcodeFormat,
  };
  allData.push(newData);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(allData));
  triggerFeedback();
  Toast.fire({ icon: "success", title: `Disimpan ke ${newData.jenis}` });
  if (document.getElementById("view-session").classList.contains("active"))
    renderToday();
  if (document.getElementById("view-database").classList.contains("active"))
    renderDatabase();
}

function formatTgl(tgl) {
  if (!tgl || tgl === "-") return "-";
  const p = tgl.split("-");
  return p.length === 3 ? `${p[2]}/${p[1]}/${p[0].substring(2)}` : tgl;
}

function createTableRows(dataArray, tableIdStr) {
  const tbody = document.getElementById(tableIdStr);
  tbody.innerHTML = "";
  let totalM2 = 0; // Inisialisasi Total Penjumlahan M2

  if (dataArray.length === 0) {
    tbody.innerHTML = `<tr><td colspan="11" style="text-align:center; padding: 40px; color: var(--text-muted); font-weight:700;">Data tidak tersedia</td></tr>`;
    return;
  }

  dataArray.forEach((i, idx) => {
    const m2Val = parseFloat(i.persegi) || 0;
    totalM2 += m2Val; // Menjumlahkan M2

    const logDisp = i.log || i.golongan || "-"; // Fallback ke golongan bila data lama belum dihapus
    const bundleDisp = i.bundle || "-";

    const tr = document.createElement("tr");
    let renderKode = `<span class="badge">${i.kode}</span>`;
    if (tableIdStr.includes("Db")) {
      tr.innerHTML = `<td>${idx + 1}</td><td>${renderKode}</td><td><b>${logDisp}</b></td><td><b>${bundleDisp}</b></td><td>${i.panjang}</td><td>${i.lebar}</td><td>${i.potongan}</td><td>${i.persegi}</td><td>${formatTgl(i.tanggal)}</td><td>${i.jam.substring(0, 5)}</td><td><button class="btn-del" onclick="hapus(${i.id}, 'db')"><i class="fas fa-trash"></i></button></td>`;
    } else {
      tr.innerHTML = `<td>${idx + 1}</td><td>${renderKode}</td><td><b>${logDisp}</b></td><td><b>${bundleDisp}</b></td><td>${i.panjang}</td><td>${i.lebar}</td><td>${i.potongan}</td><td>${i.persegi}</td><td>${i.jam.substring(0, 5)}</td><td><button class="btn-del" onclick="hapus(${i.id}, 'today')"><i class="fas fa-trash"></i></button></td>`;
    }
    tbody.appendChild(tr);
  });

  // Menambahkan Baris Total Rekap M2 Paling Bawah
  const totalTr = document.createElement("tr");
  totalTr.style.backgroundColor = "rgba(56, 189, 248, 0.1)";
  if (tableIdStr.includes("Db")) {
    // Colspan 7 (No s/d Potongan)
    totalTr.innerHTML = `<td colspan="7" style="text-align:right; font-weight:800; color:#38bdf8;">TOTAL M²:</td><td style="font-weight:800; color:#10b981;">${totalM2.toFixed(2)}</td><td colspan="3"></td>`;
  } else {
    // Colspan 7 (No s/d Potongan)
    totalTr.innerHTML = `<td colspan="7" style="text-align:right; font-weight:800; color:#38bdf8;">TOTAL M²:</td><td style="font-weight:800; color:#10b981;">${totalM2.toFixed(2)}</td><td colspan="2"></td>`;
  }
  tbody.appendChild(totalTr);
}

function renderToday() {
  const nowDate = new Date();
  const hariIni = new Date(
    nowDate.getTime() - nowDate.getTimezoneOffset() * 60000,
  )
    .toISOString()
    .split("T")[0];
  createTableRows(
    allData
      .filter((i) => i.tanggal === hariIni && i.jenis === "Barcode 1")
      .sort((a, b) => b.scannedAt - a.scannedAt),
    "tableToday1",
  );
  createTableRows(
    allData
      .filter((i) => i.tanggal === hariIni && i.jenis === "Barcode 2")
      .sort((a, b) => b.scannedAt - a.scannedAt),
    "tableToday2",
  );
  createTableRows(
    allData
      .filter((i) => i.tanggal === hariIni && i.jenis === "Barcode 3")
      .sort((a, b) => b.scannedAt - a.scannedAt),
    "tableToday3",
  );
}

function renderDatabase() {
  const start = document.getElementById("start").value,
    end = document.getElementById("end").value,
    search = document.getElementById("search").value.toLowerCase();
  let filtered = allData.filter((i) => {
    if (start && i.tanggal < start) return false;
    if (end && i.tanggal > end) return false;

    const logDisp = i.log || i.golongan || "";
    const bundleDisp = i.bundle || "";

    if (
      search &&
      !i.kode.toLowerCase().includes(search) &&
      !logDisp.toLowerCase().includes(search) &&
      !bundleDisp.toLowerCase().includes(search)
    )
      return false;
    return true;
  });
  createTableRows(
    filtered
      .filter((i) => i.jenis === "Barcode 1")
      .sort((a, b) => b.scannedAt - a.scannedAt),
    "tableDb1",
  );
  createTableRows(
    filtered
      .filter((i) => i.jenis === "Barcode 2")
      .sort((a, b) => b.scannedAt - a.scannedAt),
    "tableDb2",
  );
  createTableRows(
    filtered
      .filter((i) => i.jenis === "Barcode 3")
      .sort((a, b) => b.scannedAt - a.scannedAt),
    "tableDb3",
  );
}

function hapus(id, source) {
  const itemTarget = allData.find((i) => i.id === id);
  if (!itemTarget) return;
  Swal.fire({
    title: "Hapus Data?",
    text: "Data akan dihapus permanen.",
    icon: "warning",
    customClass: { popup: "swal-dark-custom" },
    showCancelButton: true,
    confirmButtonColor: "var(--danger)",
    cancelButtonColor: "rgba(255, 255, 255, 0.15)",
    confirmButtonText: "Ya, Hapus",
    cancelButtonText: "Batal",
  }).then((res) => {
    if (res.isConfirmed) {
      allData = allData.filter((i) => i.id !== id);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(allData));
      scannedCodesSet.delete(itemTarget.kode);
      if (source === "today") {
        renderToday();
        renderDatabase();
      }
      if (source === "db") {
        renderDatabase();
        renderToday();
      }
    }
  });
}

function hapusSemuaData() {
  Swal.fire({
    title: "Format Database?",
    text: "Seluruh data akan dihapus total!",
    icon: "warning",
    customClass: { popup: "swal-dark-custom" },
    showCancelButton: true,
    confirmButtonColor: "var(--danger)",
    cancelButtonColor: "rgba(255, 255, 255, 0.15)",
    confirmButtonText: "Ya, Format Total",
    cancelButtonText: "Batal",
  }).then((res) => {
    if (res.isConfirmed) {
      localStorage.removeItem(STORAGE_KEY);
      localStorage.removeItem("SCMMasterDB");
      allData = [];
      scannedCodesSet.clear();
      masterDB = {};
      renderToday();
      renderDatabase();
      Toast.fire({ icon: "success", title: "Aplikasi Dibersihkan!" });
    }
  });
}

function getExcelBlob(dataArray) {
  const wb = XLSX.utils.book_new();
  ["Barcode 1", "Barcode 2", "Barcode 3"].forEach((type) => {
    const typeData = dataArray.filter((i) => i.jenis === type);
    if (typeData.length > 0) {
      typeData.sort((a, b) => a.scannedAt - b.scannedAt);

      let sumM2 = 0;
      const dt = typeData.map((i, idx) => {
        sumM2 += parseFloat(i.persegi) || 0;
        return {
          No: idx + 1,
          "Kode Barcode": i.kode,
          LOG: i.log || i.golongan || "-",
          BUNDLE: i.bundle || "-",
          Panjang: i.panjang,
          Lebar: i.lebar,
          Potongan: i.potongan,
          "Persegi (m2)": i.persegi,
          Tanggal: formatTgl(i.tanggal),
          Jam: i.jam,
        };
      });

      // Rekap Total M2 Paling Bawah
      dt.push({
        No: "",
        "Kode Barcode": "",
        LOG: "",
        BUNDLE: "",
        Panjang: "",
        Lebar: "",
        Potongan: "TOTAL M2:",
        "Persegi (m2)": sumM2.toFixed(2),
        Tanggal: "",
        Jam: "",
      });

      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(dt), type);
    }
  });
  const wbout = XLSX.write(wb, { bookType: "xlsx", type: "array" });
  return new Blob([wbout], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}

function getPDFBlob(dataArray, label) {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF("p", "pt", "a4");
  doc.setFontSize(14);
  doc.text(`Laporan Data Scan - PT. Daya Sakti Niaga`, 40, 40);
  doc.setFontSize(10);
  doc.setTextColor(100);
  doc.text(`Tipe Laporan: ${label.replace(/_/g, " ")}`, 40, 55);

  const tableColumn = [
    "No",
    "Jenis",
    "Kode",
    "LOG",
    "BUNDLE",
    "P",
    "L",
    "Pot",
    "M2",
    "Tanggal",
  ];
  const tableRows = [];
  let totalM2 = 0;

  dataArray
    .sort((a, b) => (a.jenis || "").localeCompare(b.jenis || ""))
    .forEach((i, idx) => {
      totalM2 += parseFloat(i.persegi) || 0;
      tableRows.push([
        idx + 1,
        i.jenis,
        i.kode,
        i.log || i.golongan || "-",
        i.bundle || "-",
        i.panjang,
        i.lebar,
        i.potongan,
        i.persegi,
        formatTgl(i.tanggal),
      ]);
    });

  tableRows.push([
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "TOTAL:",
    totalM2.toFixed(2),
    "",
  ]);

  doc.autoTable({
    head: [tableColumn],
    body: tableRows,
    startY: 70,
    styles: { fontSize: 8 },
    headStyles: { fillColor: [59, 130, 246] },
  });
  return doc.output("blob");
}

async function executeExportAction(format, period, action) {
  const hariIni = new Date(
    new Date().getTime() - new Date().getTimezoneOffset() * 60000,
  )
    .toISOString()
    .split("T")[0];
  let dataArray =
    period === "Harian"
      ? allData.filter((i) => i.tanggal === hariIni)
      : allData;

  if (dataArray.length === 0)
    return Swal.fire({
      title: "Info",
      text: "Database kosong/tidak ada data untuk diekspor.",
      icon: "info",
      customClass: { popup: "swal-dark-custom" },
    });

  const timestamp = new Date().getTime();
  let blob, filename;

  if (format === "excel") {
    blob = getExcelBlob(dataArray);
    filename = `Laporan_DSN_${period}_${timestamp}.xlsx`;
  } else {
    blob = getPDFBlob(dataArray, period);
    filename = `Laporan_DSN_${period}_${timestamp}.pdf`;
  }

  if (action === "download") {
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    window.URL.revokeObjectURL(url);
    Toast.fire({ icon: "success", title: "Berhasil Diunduh!" });
  } else if (action === "share") {
    const file = new File([blob], filename, { type: blob.type });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({
          title: `Laporan DSN ${period}`,
          files: [file],
        });
        Toast.fire({ icon: "success", title: "Membuka Menu Share..." });
      } catch (e) {
        console.log("Share dibatalkan pengguna");
      }
    } else {
      Swal.fire({
        title: "Gagal Share Direct",
        text: "Browser Anda tidak mendukung share file ke WhatsApp. File otomatis diunduh, kirim manual dari galeri.",
        icon: "warning",
        customClass: { popup: "swal-dark-custom" },
      });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      a.click();
      window.URL.revokeObjectURL(url);
    }
  }
}

function actionPrompt(format, periodType) {
  const period = periodType === "harian" ? "Harian" : "Seluruh Master Database";
  const displayFormat = format === "excel" ? "Excel (.xlsx)" : "PDF (.pdf)";

  Swal.fire({
    title: `Laporan ${displayFormat}`,
    html: `<div style="font-size:0.9rem; color:#cbd5e1; margin-bottom:15px;">Pilih aksi untuk laporan ${period}:</div>`,
    showDenyButton: true,
    showCancelButton: true,
    confirmButtonText: '<i class="fas fa-download"></i> Unduh ke HP',
    denyButtonText: '<i class="fab fa-whatsapp"></i> Share File',
    cancelButtonText: "Batal",
    confirmButtonColor: "#3b82f6",
    denyButtonColor: "#10b981",
    cancelButtonColor: "transparent",
    customClass: { popup: "swal-dark-custom" },
  }).then((result) => {
    if (result.isConfirmed)
      executeExportAction(
        format,
        periodType === "harian" ? "Harian" : "Semua",
        "download",
      );
    else if (result.isDenied)
      executeExportAction(
        format,
        periodType === "harian" ? "Harian" : "Semua",
        "share",
      );
  });
}

window.downloadExcelHarian = () => actionPrompt("excel", "harian");
window.downloadPDFHarian = () => actionPrompt("pdf", "harian");
window.downloadExcelSemua = () => actionPrompt("excel", "semua");
window.downloadPDFSemua = () => actionPrompt("pdf", "semua");
