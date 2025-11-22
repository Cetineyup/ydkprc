const Database = require('better-sqlite3');
const db = new Database('sanayi.db');

// Tabloları oluştur
db.exec(`
    CREATE TABLE IF NOT EXISTS firma_bilgileri (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        firma_adi TEXT NOT NULL,
        adres TEXT,
        telefon TEXT,
        vergi_dairesi TEXT,
        vergi_no TEXT
    )
`);

db.exec(`
    CREATE TABLE IF NOT EXISTS contacts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ad_soyad TEXT NOT NULL,
        tip TEXT NOT NULL,
        telefon TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
`);

db.exec(`
    CREATE TABLE IF NOT EXISTS sub_contacts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        parent_contact_id INTEGER NOT NULL,
        ad_soyad TEXT NOT NULL,
        arac_plaka TEXT,
        telefon TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(parent_contact_id) REFERENCES contacts(id)
    )
`);

db.exec(`
    CREATE TABLE IF NOT EXISTS transactions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        contact_id INTEGER NOT NULL, 
        sub_contact_id INTEGER,      
        tarih DATETIME DEFAULT CURRENT_TIMESTAMP,
        islem_tipi TEXT NOT NULL,
        tutar REAL NOT NULL,
        urun_aciklama TEXT,
        aciklama TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(contact_id) REFERENCES contacts(id),
        FOREIGN KEY(sub_contact_id) REFERENCES sub_contacts(id)
    )
`);

// Varsayılan veriler
const firmaSayisi = db.prepare('SELECT count(*) AS count FROM firma_bilgileri').get();
if (firmaSayisi.count === 0) {
    db.prepare(`
        INSERT INTO firma_bilgileri (firma_adi, adres, telefon, vergi_dairesi, vergi_no)
        VALUES (?, ?, ?, ?, ?)
    `).run('MÜCAHİT BAŞLI', 'Sanayi Sitesi', '0236 357 0000', 'Saruhanlı', '1234567890');
}

const cariSayisi = db.prepare('SELECT count(*) AS count FROM contacts').get();
if (cariSayisi.count === 0) {
    const insertContact = db.prepare("INSERT INTO contacts (ad_soyad, tip, telefon) VALUES (?, ?, ?)");
    insertContact.run('Motorcu Ali Usta', 'Usta', '05551234567');
    insertContact.run('Ahmet Yılmaz', 'Bireysel', '05321234567');
    
    const insertSubContact = db.prepare("INSERT INTO sub_contacts (parent_contact_id, ad_soyad, arac_plaka) VALUES (?, ?, ?)");
    insertSubContact.run(1, 'Ayşe Hanım', '34 ABC 99');
}

console.log("✅ Veritabanı hazır");
module.exports = db;