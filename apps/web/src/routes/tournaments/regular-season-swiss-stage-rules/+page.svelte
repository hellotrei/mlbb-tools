<section class="rules-page">
  <header class="hero">
    <a class="back-link" href="/tournaments">← Kembali ke Tournament</a>
    <h1 class="page-title">Swiss Stage</h1>
    <p class="page-subtitle">
      Format kompetitif di mana tim dipertemukan berdasarkan <strong>poin yang sama</strong>. Tim dengan performa serupa selalu bertemu satu sama lain — tidak ada tim yang terlalu sering ketemu lawan kuat atau lemah.
    </p>
  </header>

  <section class="rules-card highlight-card">
    <h2>Ringkasan Format</h2>
    <div class="summary-grid">
      <div class="summary-item">
        <span class="summary-label">Jumlah tim</span>
        <span class="summary-value">16 tim</span>
      </div>
      <div class="summary-item">
        <span class="summary-label">Maksimal ronde</span>
        <span class="summary-value">5 ronde</span>
      </div>
      <div class="summary-item">
        <span class="summary-label">Lolos otomatis</span>
        <span class="summary-value">3 kemenangan</span>
      </div>
      <div class="summary-item">
        <span class="summary-label">Gugur otomatis</span>
        <span class="summary-value">3 kekalahan</span>
      </div>
      <div class="summary-item">
        <span class="summary-label">Match biasa</span>
        <span class="summary-value">BO1</span>
      </div>
      <div class="summary-item">
        <span class="summary-label">Match penentuan</span>
        <span class="summary-value">BO3</span>
      </div>
    </div>
  </section>

  <section class="rules-card">
    <h2>Cara Kerja</h2>
    <ul>
      <li>Setiap ronde, tim yang memiliki <strong>poin (skor) sama</strong> saling dipertemukan. Sistem otomatis mengelompokkan pairing berdasarkan catatan menang/kalah.</li>
      <li>Tidak ada eliminasi langsung seperti knockout. Setiap tim terus bermain sampai mencapai kondisi lolos atau gugur.</li>
      <li>Tim yang sudah mencapai <strong>3 kemenangan</strong> langsung lolos (qualify) ke fase berikutnya.</li>
      <li>Tim yang sudah mencapai <strong>3 kekalahan</strong> langsung tersingkir (eliminate).</li>
      <li>Setelah Swiss selesai, <strong>Top 8 tim</strong> dengan hasil terbaik lanjut ke fase Playoffs.</li>
    </ul>
  </section>

  <section class="rules-card">
    <h2>Sistem Match</h2>
    <div class="match-types">
      <div class="match-type">
        <div class="match-badge regular">BO1</div>
        <div class="match-info">
          <h3>Match Biasa</h3>
          <p>Digunakan untuk pertandingan reguler antar tim yang belum mencapai kondisi 2-2 (belum di ujung lolos/gugur).</p>
        </div>
      </div>
      <div class="match-type">
        <div class="match-badge decider">BO3</div>
        <div class="match-info">
          <h3>Match Penentuan (Decider)</h3>
          <p>Otomatis digunakan saat kedua tim sedang berada di posisi kritis: <strong>2 win vs 2 win</strong> (penentuan lolos) atau <strong>2 loss vs 2 loss</strong> (penentuan siapa yang gugur lebih dulu).</p>
        </div>
      </div>
    </div>
  </section>

  <section class="rules-card">
    <h2>Alur Swiss Stage</h2>
    <ol>
      <li>Event dibuat dengan 16 tim. Ronde 1 bisa memakai <em>Default Match</em> (berdasarkan seed) atau <em>Shuffle Match</em> (acak).</li>
      <li>Setiap ronde berikutnya, sistem otomatis mengelompokkan pairing berdasarkan skor yang sama.</li>
      <li>Jika ada tim yang poinnya ganjil di satu grup (tidak bisa dipasangkan), satu tim mendapat <strong>bye</strong> (menang otomatis 1 poin).</li>
      <li>Setelah ronde selesai, kondisi setiap tim dicek:
        <ul>
          <li>3 win → otomatis <strong>lolos</strong>, tidak perlu main lagi</li>
          <li>3 loss → otomatis <strong>gugur</strong>, tidak perlu main lagi</li>
        </ul>
      </li>
      <li>Proses ini berlanjut hingga maksimal 5 ronde atau semua tim sudah ditentukan nasibnya.</li>
      <li>Top 8 dari seluruh peserta lanjut ke fase Playoffs di event yang sama.</li>
    </ol>
  </section>

  <section class="rules-card">
    <h2>Contoh Jalur Tim</h2>
    <div class="example-table-wrap">
      <table class="example-table">
        <thead>
          <tr><th>Setelah Ronde</th><th>Catatan Tim</th><th>Status</th></tr>
        </thead>
        <tbody>
          <tr><td>Ronde 3</td><td>3W - 0L</td><td class="status-qualify">✅ Lolos</td></tr>
          <tr><td>Ronde 3</td><td>0W - 3L</td><td class="status-eliminated">❌ Gugur</td></tr>
          <tr><td>Ronde 4</td><td>3W - 1L</td><td class="status-qualify">✅ Lolos</td></tr>
          <tr><td>Ronde 4</td><td>1W - 3L</td><td class="status-eliminated">❌ Gugur</td></tr>
          <tr><td>Ronde 5</td><td>3W - 2L</td><td class="status-qualify">✅ Lolos</td></tr>
          <tr><td>Ronde 5</td><td>2W - 3L</td><td class="status-eliminated">❌ Gugur</td></tr>
        </tbody>
      </table>
    </div>
    <p class="note">Match di Ronde 5 antara tim 2-2 vs 2-2 menggunakan BO3 (match penentuan).</p>
  </section>

  <section class="rules-card">
    <h2>Sistem Poin & Tiebreaker</h2>
    <ul>
      <li><strong>Menang</strong> → 1 poin</li>
      <li><strong>Kalah</strong> → 0 poin</li>
      <li><strong>Bye</strong> → 1 poin (diberikan otomatis jika pasangan tidak tersedia)</li>
    </ul>
    <p class="note">Tiebreaker untuk menentukan Top 8 diurutkan: Poin → H2H → Buchholz → Pts Diff.</p>
  </section>

  <section class="rules-card">
    <h2>Tips</h2>
    <ul>
      <li>Swiss Stage sangat efisien: dengan 16 tim dan maksimal 5 ronde, format ini tetap menghasilkan Top 8 yang berkualitas.</li>
      <li>Karena pairing berdasarkan skor yang sama, tim kuat cenderung bertemu tim kuat — sehingga Top 8 benar-benar merepresentasikan tim terbaik.</li>
      <li>Match BO3 di penentuan membuat hasil lebih adil dan mengurangi faktor keberuntungan di momen kritis.</li>
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

  .match-types {
    display: grid;
    gap: 10px;
  }

  .match-type {
    display: flex;
    gap: 12px;
    align-items: flex-start;
    background: rgba(255, 255, 255, 0.03);
    border-radius: 10px;
    padding: 12px;
  }

  .match-badge {
    flex-shrink: 0;
    padding: 6px 10px;
    border-radius: 8px;
    font-weight: 700;
    font-size: 0.82rem;
    letter-spacing: 0.03em;
  }

  .match-badge.regular {
    background: rgba(23, 93, 129, 0.4);
    color: #9ee7ff;
    border: 1px solid rgba(102, 213, 255, 0.3);
  }

  .match-badge.decider {
    background: rgba(147, 103, 20, 0.3);
    color: #ffd58c;
    border: 1px solid rgba(255, 191, 89, 0.3);
  }

  .match-info h3 {
    font-size: 0.9rem;
    margin: 0 0 4px;
  }

  .match-info p {
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

  .status-qualify {
    color: #9cffbf;
    font-weight: 600;
  }

  .status-eliminated {
    color: #ff9c9c;
    font-weight: 600;
  }

  @media (max-width: 480px) {
    .summary-grid {
      grid-template-columns: 1fr 1fr;
    }
  }
</style>
