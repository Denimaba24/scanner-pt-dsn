const express = require("express");
const cors = require("cors");
const mysql = require("mysql2/promise");

const app = express();
const PORT = 3000;

app.use(cors());
app.use(express.json());

// Konfigurasi Koneksi Database MySQL (Bawaan XAMPP)
const pool = mysql.createPool({
  host: "localhost",
  user: "root",
  password: "",
  database: "db_scanner_dsn",
  dateStrings: true,
});

// --- API ROUTES UNTUK RIWAYAT SCAN ---
app.get("/api/scans", async (req, res) => {
  try {
    const [rows] = await pool.query("SELECT * FROM riwayat_scan");
    const formattedData = rows.map((row) => ({
      id: row.id,
      scannedAt: row.scanned_at,
      kode: row.kode,
      jenis: row.jenis,
      log: row.log_barcode,
      bundle: row.bundle,
      panjang: row.panjang,
      lebar: row.lebar,
      potongan: row.potongan,
      persegi: row.persegi,
      tanggal: row.tanggal,
      jam: row.jam,
      format: row.format_scan,
    }));
    res.json(formattedData);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Gagal mengambil data dari database MySQL" });
  }
});

app.post("/api/scans", async (req, res) => {
  const data = req.body;
  try {
    const query = `
            INSERT INTO riwayat_scan 
            (id, kode, jenis, log_barcode, bundle, panjang, lebar, potongan, persegi, tanggal, jam, format_scan, scanned_at) 
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `;
    const values = [
      data.id,
      data.kode,
      data.jenis,
      data.log,
      data.bundle,
      data.panjang,
      data.lebar,
      data.potongan,
      data.persegi,
      data.tanggal,
      data.jam,
      data.format,
      data.scannedAt,
    ];

    await pool.query(query, values);
    res.status(201).json({ message: "Data scan berhasil disimpan ke MySQL" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Gagal menyimpan data scan" });
  }
});

app.delete("/api/scans/:id", async (req, res) => {
  try {
    await pool.query("DELETE FROM riwayat_scan WHERE id = ?", [req.params.id]);
    res.json({ message: "Data berhasil dihapus dari MySQL" });
  } catch (err) {
    res.status(500).json({ error: "Gagal menghapus data" });
  }
});

app.delete("/api/scans", async (req, res) => {
  try {
    await pool.query("TRUNCATE TABLE riwayat_scan");
    await pool.query("TRUNCATE TABLE master_barcode");
    res.json({ message: "Semua data berhasil dikosongkan dari MySQL" });
  } catch (err) {
    res.status(500).json({ error: "Gagal memformat database" });
  }
});

// --- API ROUTES UNTUK MASTER BARCODE ---
app.get("/api/master", async (req, res) => {
  try {
    const [rows] = await pool.query("SELECT * FROM master_barcode");
    let masterDB = {};
    rows.forEach((row) => {
      const frontendData = {
        jenisBarcode: row.jenis,
        log: row.log_barcode,
        bundle: row.bundle,
        panjang: row.panjang,
        lebar: row.lebar,
        potongan: row.potongan,
        persegi: row.persegi,
      };
      masterDB[row.kode] = frontendData;
      masterDB[row.kode.substring(0, 8)] = frontendData;
    });
    res.json(masterDB);
  } catch (err) {
    res.status(500).json({ error: "Gagal mengambil data master" });
  }
});

app.post("/api/master", async (req, res) => {
  const { kode, data } = req.body;
  try {
    const query = `
            INSERT INTO master_barcode 
            (kode, jenis, log_barcode, bundle, panjang, lebar, potongan, persegi) 
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            ON DUPLICATE KEY UPDATE 
            jenis=VALUES(jenis), log_barcode=VALUES(log_barcode), bundle=VALUES(bundle), 
            panjang=VALUES(panjang), lebar=VALUES(lebar), potongan=VALUES(potongan), persegi=VALUES(persegi)
        `;
    const values = [
      kode,
      data.jenisBarcode,
      data.log,
      data.bundle,
      data.panjang,
      data.lebar,
      data.potongan,
      data.persegi,
    ];
    await pool.query(query, values);
    res.status(201).json({ message: "Master data disimpan ke MySQL" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Gagal menyimpan data master" });
  }
});

// Jalankan Server
app.listen(PORT, () => {
  console.log(`🚀 Backend server berjalan di http://localhost:${PORT}`);
  console.log(`✅ Server kini TERHUBUNG secara langsung ke MySQL XAMPP!`);
});
