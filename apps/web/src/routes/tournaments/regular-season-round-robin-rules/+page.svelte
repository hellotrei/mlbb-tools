<section class="rules-page">
  <header class="hero">
    <a class="back-link" href="/tournaments">← Kembali ke Tournament</a>
    <h1 class="page-title">Round Robin</h1>
    <p class="page-subtitle">
      Format standar di mana setiap tim bertemu semua tim lainnya tepat satu kali. Jadwal dibuat otomatis oleh sistem — tidak perlu pairing manual.
    </p>
  </header>

  <section class="rules-card highlight-card">
    <h2>Ringkasan Format</h2>
    <div class="summary-grid">
      <div class="summary-item">
        <span class="summary-label">Pertemuan antar tim</span>
        <span class="summary-value">1x</span>
      </div>
      <div class="summary-item">
        <span class="summary-label">Pairing</span>
        <span class="summary-value">Otomatis</span>
      </div>
      <div class="summary-item">
        <span class="summary-label">Jumlah tim</span>
        <span class="summary-value">Genap</span>
      </div>
      <div class="summary-item">
        <span class="summary-label">Cocok untuk</span>
        <span class="summary-value">Liga kecil–menengah</span>
      </div>
    </div>
  </section>

  <section class="rules-card">
    <h2>Cara Kerja</h2>
    <ul>
      <li>Semua tim saling bertemu <strong>1 kali</strong>. Tidak ada tim yang berulang bertemu di format ini.</li>
      <li>Sistem secara otomatis membuat jadwal lengkap sejak awal. Admin tidak perlu memilih pairing setiap ronde.</li>
      <li>Jumlah total match = <code>N × (N − 1) / 2</code> untuk <code>N</code> tim. Contoh: 8 tim = 28 match total.</li>
      <li>Setiap ronde, setiap tim biasanya hanya main 1 pertandingan (kecuali ada tim bye jika jumlah tim ganjil).</li>
      <li>Setelah semua ronde selesai, standing akhir dipakai untuk menentukan tim yang lolos ke playoffs.</li>
    </ul>
  </section>

  <section class="rules-card">
    <h2>Alur Regular Season</h2>
    <ol>
      <li>Admin membuat event dan memilih format <strong>Round Robin</strong>.</li>
      <li>Sistem otomatis membuat jadwal semua ronde sekaligus.</li>
      <li>Admin membuka tiap ronde dan menginput hasil match.</li>
      <li>Setelah semua ronde selesai, standing final terbentuk.</li>
      <li>Tim-tim teratas (sesuai konfigurasi <em>Playoff Advance</em>) lolos ke playoffs.</li>
    </ol>
  </section>

  <section class="rules-card">
    <h2>Sistem Poin & Tiebreaker</h2>
    <ul>
      <li><strong>Menang</strong> → 1 poin</li>
      <li><strong>Seri</strong> → 0.5 poin (hanya BO genap)</li>
      <li><strong>Kalah</strong> → 0 poin</li>
      <li><strong>Bye</strong> → 1 poin (otomatis jika jumlah tim ganjil)</li>
    </ul>
    <p class="note">Tiebreaker diurutkan: Poin → H2H → Buchholz → Pts Diff → W/L/D/Bye.</p>
  </section>

  <section class="rules-card">
    <h2>Aturan Best-of (BO)</h2>
    <ul>
      <li><strong>BO1</strong> → hasil 1-0 atau 0-1 (bisa draw jika melewati 20 menit)</li>
      <li><strong>BO2</strong> → hasil 2-0, 1-1 (draw), atau 0-2</li>
      <li><strong>BO3</strong> → hasil 2-0, 2-1, 1-2, atau 0-2</li>
      <li>BO <strong>genap</strong> bisa berakhir seri. BO <strong>ganjil</strong> selalu menghasilkan pemenang.</li>
    </ul>
  </section>

  <section class="rules-card">
    <h2>Contoh Jadwal (8 Tim)</h2>
    <p class="note">Dengan 8 tim, Round Robin menghasilkan 7 ronde dengan 4 match per ronde.</p>
    <div class="example-table-wrap">
      <table class="example-table">
        <thead>
          <tr><th>Ronde</th><th>Jumlah Match</th></tr>
        </thead>
        <tbody>
          <tr><td>Ronde 1</td><td>4 match</td></tr>
          <tr><td>Ronde 2</td><td>4 match</td></tr>
          <tr><td>Ronde 3</td><td>4 match</td></tr>
          <tr><td>…</td><td>…</td></tr>
          <tr><td>Ronde 7</td><td>4 match</td></tr>
        </tbody>
      </table>
    </div>
  </section>

  <section class="rules-card">
    <h2>Tips</h2>
    <ul>
      <li>Format ini ideal kalau ingin semua tim saling bertemu setidaknya sekali, menjamin keadilan kompetitif.</li>
      <li>Karena jadwal sudah otomatis, Round Robin tidak butuh banyak pengaturan dari admin setelah event dibuat.</li>
      <li>Gunakan Double Round Robin jika ingin setiap tim bertemu dua kali untuk hasil yang lebih representatif.</li>
    </ul>
  </section>
</section>

<style>
  .rules-page {
    display: grid;
    gap: 16px;
  }

  .hero {
    display: grid;
    gap: 8px;
  }

  .hero > * {
    margin: 0;
  }

  .back-link {
    color: var(--muted);
    font-size: 0.9rem;
    text-decoration: none;
  }

  .back-link:hover {
    color: var(--text);
  }

  .rules-card {
    border: 1px solid rgba(123, 220, 255, 0.14);
    border-radius: 16px;
    background: rgba(9, 18, 34, 0.6);
    padding: 16px;
    display: grid;
    gap: 12px;
  }

  .highlight-card {
    border-color: rgba(123, 220, 255, 0.28);
    background: rgba(12, 28, 56, 0.7);
  }

  .rules-card h2 {
    margin: 0;
    font-size: 1rem;
  }

  .rules-card ul,
  .rules-card ol {
    margin: 0;
    padding-left: 20px;
    color: var(--muted);
    display: grid;
    gap: 8px;
  }

  .rules-card li {
    line-height: 1.5;
  }

  .summary-grid {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 10px;
  }

  .summary-item {
    background: rgba(255, 255, 255, 0.04);
    border-radius: 10px;
    padding: 10px 12px;
    display: grid;
    gap: 4px;
  }

  .summary-label {
    color: var(--muted);
    font-size: 0.8rem;
  }

  .summary-value {
    font-size: 0.95rem;
    font-weight: 600;
  }

  .note {
    color: var(--muted);
    font-size: 0.88rem;
    margin: 0;
  }

  .example-table-wrap {
    overflow-x: auto;
  }

  .example-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.9rem;
  }

  .example-table th,
  .example-table td {
    padding: 8px 12px;
    text-align: left;
    border-bottom: 1px solid rgba(123, 220, 255, 0.08);
  }

  .example-table th {
    color: var(--muted);
    font-weight: 600;
    font-size: 0.82rem;
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }

  code {
    font-size: 0.9em;
  }

  @media (max-width: 480px) {
    .summary-grid {
      grid-template-columns: 1fr 1fr;
    }
  }
</style>
