<section class="rules-page">
  <header class="hero">
    <a class="back-link" href="/tournaments">← Kembali ke Tournament</a>
    <h1 class="page-title">5 Round</h1>
    <p class="page-subtitle">
      Format fleksibel di mana setiap tim hanya perlu main <strong>5 ronde</strong>. Tidak semua tim harus saling bertemu — cocok untuk turnamen dengan banyak peserta dan waktu terbatas.
    </p>
  </header>

  <section class="rules-card highlight-card">
    <h2>Ringkasan Format</h2>
    <div class="summary-grid">
      <div class="summary-item">
        <span class="summary-label">Jumlah ronde</span>
        <span class="summary-value">5 ronde tetap</span>
      </div>
      <div class="summary-item">
        <span class="summary-label">Pairing</span>
        <span class="summary-value">Manual oleh admin</span>
      </div>
      <div class="summary-item">
        <span class="summary-label">Wajib bertemu semua?</span>
        <span class="summary-value">Tidak</span>
      </div>
      <div class="summary-item">
        <span class="summary-label">Cocok untuk</span>
        <span class="summary-value">Turnamen besar, waktu singkat</span>
      </div>
    </div>
  </section>

  <section class="rules-card">
    <h2>Cara Kerja</h2>
    <ul>
      <li>Setiap tim main selama tepat <strong>5 ronde</strong>. Jumlah ini tidak bisa diubah.</li>
      <li>Tidak ada kewajiban setiap tim bertemu semua lawan. Pairing bisa berulang jika diperlukan.</li>
      <li>Admin memilih pairing setiap ronde secara manual menggunakan pilihan <strong>Default Match</strong> atau <strong>Shuffle Match</strong>.</li>
      <li>Sebelum ronde dibuat, bot menampilkan <strong>preview pairing</strong> terlebih dahulu. Admin bisa mengonfirmasi atau mengacak ulang.</li>
    </ul>
  </section>

  <section class="rules-card">
    <h2>Pilihan Pairing</h2>
    <div class="pairing-options">
      <div class="pairing-option">
        <h3>📋 Default Match</h3>
        <p>Pairing mengikuti urutan standing atau seed yang berlaku. Tim dengan skor lebih dekat cenderung dipertemukan.</p>
      </div>
      <div class="pairing-option">
        <h3>🔀 Shuffle Match</h3>
        <p>Pairing diacak secara otomatis. Sistem berusaha menghindari rematch berulang dan pasangan yang sudah bertemu lebih dari 2 kali.</p>
      </div>
    </div>
    <p class="note">Admin bisa terus memilih <strong>Shuffle Again</strong> sampai mendapat pairing yang sesuai sebelum mengonfirmasi.</p>
  </section>

  <section class="rules-card">
    <h2>Alur Regular Season</h2>
    <ol>
      <li>Admin membuat event dan memilih format <strong>5 Round</strong>.</li>
      <li>Bot menampilkan preview pairing Ronde 1. Admin memilih <em>Default Match</em> atau <em>Shuffle Match</em>.</li>
      <li>Setelah pairing dikonfirmasi, Ronde 1 dibuat dan admin bisa mulai menginput hasil match.</li>
      <li>Setelah semua match di ronde aktif selesai, tombol <strong>Generate Next Round</strong> muncul.</li>
      <li>Proses pairing preview → konfirmasi → input hasil diulang sampai Ronde 5 selesai.</li>
      <li>Standing akhir terbentuk. Tim-tim teratas lolos ke playoffs.</li>
    </ol>
  </section>

  <section class="rules-card">
    <h2>Sistem Poin & Tiebreaker</h2>
    <ul>
      <li><strong>Menang</strong> → 1 poin</li>
      <li><strong>Seri</strong> → 0.5 poin (hanya BO genap)</li>
      <li><strong>Kalah</strong> → 0 poin</li>
      <li><strong>Bye</strong> → 1 poin (otomatis jika jumlah tim ganjil di ronde tersebut)</li>
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
    <h2>Tips</h2>
    <ul>
      <li>Format 5 Round ideal untuk turnamen komunitas besar (12+ tim) yang tidak punya cukup waktu untuk Round Robin penuh.</li>
      <li>Gunakan Shuffle Match agar distribusi lawan lebih merata dan menghindari pertandingan yang terlalu berulang.</li>
      <li>Jika ingin jumlah ronde berbeda dari 5, gunakan format <a class="inline-link" href="/tournaments/regular-season-custom-round-rules">Custom Round</a>.</li>
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

  .pairing-options {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 10px;
  }

  .pairing-option {
    background: rgba(255, 255, 255, 0.04);
    border-radius: 10px;
    padding: 12px;
    display: grid;
    gap: 6px;
  }

  .pairing-option h3 {
    font-size: 0.9rem;
    margin: 0;
  }

  .pairing-option p {
    color: var(--muted);
    font-size: 0.86rem;
    margin: 0;
    line-height: 1.5;
  }

  .note {
    color: var(--muted);
    font-size: 0.88rem;
    margin: 0;
  }

  .inline-link {
    color: #9ee7ff;
    text-decoration: underline;
  }

  @media (max-width: 480px) {
    .pairing-options {
      grid-template-columns: 1fr;
    }
  }
</style>
