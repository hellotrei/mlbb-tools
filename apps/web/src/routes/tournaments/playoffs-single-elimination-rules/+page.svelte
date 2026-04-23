<section class="rules-page">
  <header class="hero">
    <a class="back-link" href="/tournaments">← Kembali ke Tournament</a>
    <span class="breadcrumb-tag">Playoffs</span>
    <h1 class="page-title">Single Elimination</h1>
    <p class="page-subtitle">
      Format gugur langsung yang paling umum. <strong>Menang = lanjut, kalah = gugur.</strong> Setiap ronde memangkas separuh peserta hingga tersisa satu juara.
    </p>
  </header>

  <section class="rules-card highlight-card">
    <h2>Ringkasan Format</h2>
    <div class="summary-grid">
      <div class="summary-item">
        <span class="summary-label">Sistem</span>
        <span class="summary-value">Gugur 1x kalah</span>
      </div>
      <div class="summary-item">
        <span class="summary-label">Jumlah tim</span>
        <span class="summary-value">Bebas (ganjil/genap)</span>
      </div>
      <div class="summary-item">
        <span class="summary-label">BO per fase</span>
        <span class="summary-value">Bisa berbeda</span>
      </div>
      <div class="summary-item">
        <span class="summary-label">Opsi 3rd Place</span>
        <span class="summary-value">Bisa diaktifkan</span>
      </div>
    </div>
  </section>

  <section class="rules-card">
    <h2>Cara Kerja</h2>
    <ul>
      <li>Setiap pertandingan bersifat gugur. Tim yang <strong>kalah langsung tersingkir</strong> dari kompetisi.</li>
      <li>Tim yang <strong>menang terus lanjut</strong> ke ronde berikutnya sampai tersisa satu juara.</li>
      <li>Seeding awal menentukan bracket — tim seeded tinggi cenderung bertemu lawan lebih mudah di awal.</li>
      <li>Bracket lengkap ditampilkan di halaman web dengan konektor antar ronde.</li>
    </ul>
  </section>

  <section class="rules-card">
    <h2>Konfigurasi Best-of (BO) per Fase</h2>
    <p class="section-note">Admin bisa mengatur BO yang berbeda untuk setiap fase saat membuat event:</p>
    <div class="phase-list">
      <div class="phase-item">
        <div class="phase-label">Early Rounds</div>
        <div class="phase-desc">Ronde-ronde awal sebelum semifinal. Biasanya BO1 atau BO3.</div>
      </div>
      <div class="phase-item">
        <div class="phase-label">Semifinal</div>
        <div class="phase-desc">Pilihan tersedia: <strong>BO1</strong>, <strong>BO3</strong>, atau <strong>BO5</strong>.</div>
      </div>
      <div class="phase-item">
        <div class="phase-label">Final</div>
        <div class="phase-desc">Pilihan tersedia: <strong>BO3</strong>, <strong>BO5</strong>, atau <strong>BO7</strong>.</div>
      </div>
      <div class="phase-item optional">
        <div class="phase-label">3rd Place Match <span class="optional-tag">Opsional</span></div>
        <div class="phase-desc">Bisa diaktifkan saat setup event. Admin memilih BO khusus untuk laga perebutan juara 3.</div>
      </div>
    </div>
  </section>

  <section class="rules-card">
    <h2>Alur Playoffs</h2>
    <ol>
      <li>Admin membuat event Playoffs → pilih sub-mode <strong>Knockout Single Elimination</strong>.</li>
      <li>Pilih BO untuk early rounds, semifinal, dan final. Tentukan apakah ada <em>3rd Place Match</em>.</li>
      <li>Input jumlah tim dan nama tim (atau lanjut dari Regular Season dengan seeding otomatis).</li>
      <li>
        Sebelum memulai bracket, admin memilih <strong>Seeding Policy</strong>:
        <ul>
          <li><strong>Balanced</strong> – seeding merata antar slot (default)</li>
          <li><strong>Strict Rank</strong> – urutan penuh berdasarkan ranking akhir RS</li>
          <li><strong>Avoid Same Group</strong> – menghindari pertemuan tim dari group RS yang sama di babak awal</li>
        </ul>
      </li>
      <li>Bracket terbentuk. Ronde pertama siap dimulai.</li>
      <li>Admin menginput hasil tiap match. Tim menang lanjut, tim kalah gugur.</li>
      <li>Setelah semua match ronde selesai, klik <strong>Generate Next Round</strong> untuk lanjut.</li>
      <li>Bracket berlanjut hingga Final selesai dan juara ditentukan.</li>
      <li>Jika 3rd Place Match aktif, pertandingan juara 3 berlangsung sejajar dengan Final.</li>
    </ol>
  </section>

  <section class="rules-card">
    <h2>Contoh Bracket (8 Tim)</h2>
    <div class="bracket-diagram">
      <div class="bracket-round">
        <div class="bracket-round-label">Perempat Final (4 match)</div>
        <div class="bracket-matches">
          <div class="bracket-match"><span class="seed">#1</span> vs <span class="seed">#8</span></div>
          <div class="bracket-match"><span class="seed">#4</span> vs <span class="seed">#5</span></div>
          <div class="bracket-match"><span class="seed">#2</span> vs <span class="seed">#7</span></div>
          <div class="bracket-match"><span class="seed">#3</span> vs <span class="seed">#6</span></div>
        </div>
      </div>
      <div class="bracket-arrow">→</div>
      <div class="bracket-round">
        <div class="bracket-round-label">Semifinal (2 match)</div>
        <div class="bracket-matches">
          <div class="bracket-match">W1 vs W2</div>
          <div class="bracket-match">W3 vs W4</div>
        </div>
      </div>
      <div class="bracket-arrow">→</div>
      <div class="bracket-round">
        <div class="bracket-round-label">Final (1 match)</div>
        <div class="bracket-matches">
          <div class="bracket-match final">W SF1 vs W SF2</div>
        </div>
      </div>
    </div>
    <p class="note">Jika 3rd Place aktif: tim kalah di Semifinal bermain memperebutkan posisi ke-3.</p>
  </section>

  <section class="rules-card">
    <h2>Tampilan Web</h2>
    <ul>
      <li>Bracket Single Elimination ditampilkan dengan <strong>konektor garis penuh</strong> antar ronde di halaman web.</li>
      <li>Setiap match menampilkan nama tim, skor, dan status (pending / selesai).</li>
      <li>Bracket bisa langsung dibagikan ke peserta melalui tombol <strong>Open Web</strong> di bot.</li>
    </ul>
  </section>

  <section class="rules-card">
    <h2>Tips</h2>
    <ul>
      <li>Single Elimination cocok untuk babak final yang butuh waktu singkat dan drama tinggi.</li>
      <li>Gunakan BO3 atau BO5 di Semifinal/Final untuk mengurangi faktor keberuntungan di laga penting.</li>
      <li>Aktifkan 3rd Place Match kalau turnamen perlu menentukan posisi ke-3 secara resmi (misalnya untuk hadiah atau promosi).</li>
      <li>Jika lanjutan dari Regular Season, sistem bisa langsung menarik seeding dari standing RS — tidak perlu input ulang.</li>
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
    gap: 6px;
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

  .breadcrumb-tag {
    display: inline-block;
    padding: 3px 9px;
    border-radius: 999px;
    font-size: 0.75rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    background: rgba(147, 103, 20, 0.28);
    color: #ffd58c;
    border: 1px solid rgba(255, 191, 89, 0.28);
    width: fit-content;
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

  .section-note {
    color: var(--muted);
    font-size: 0.88rem;
    margin: 0;
  }

  .phase-list {
    display: grid;
    gap: 8px;
  }

  .phase-item {
    display: grid;
    grid-template-columns: 150px 1fr;
    gap: 10px;
    align-items: start;
    padding: 10px 12px;
    background: rgba(255, 255, 255, 0.03);
    border-radius: 10px;
    border-left: 3px solid rgba(123, 220, 255, 0.3);
  }

  .phase-item.optional {
    border-left-color: rgba(255, 191, 89, 0.4);
  }

  .phase-label {
    font-size: 0.88rem;
    font-weight: 600;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .optional-tag {
    font-size: 0.72rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: #ffd58c;
    background: rgba(147, 103, 20, 0.24);
    padding: 1px 6px;
    border-radius: 999px;
    width: fit-content;
  }

  .phase-desc {
    color: var(--muted);
    font-size: 0.86rem;
    line-height: 1.5;
  }

  .note {
    color: var(--muted);
    font-size: 0.88rem;
    margin: 0;
  }

  .bracket-diagram {
    display: flex;
    gap: 10px;
    align-items: center;
    overflow-x: auto;
    padding-bottom: 4px;
  }

  .bracket-round {
    display: grid;
    gap: 8px;
    min-width: 140px;
  }

  .bracket-round-label {
    font-size: 0.76rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--muted);
  }

  .bracket-matches {
    display: grid;
    gap: 6px;
  }

  .bracket-match {
    padding: 7px 10px;
    border-radius: 8px;
    font-size: 0.82rem;
    background: rgba(255, 255, 255, 0.04);
    border: 1px solid rgba(123, 220, 255, 0.1);
    white-space: nowrap;
  }

  .bracket-match.final {
    border-color: rgba(255, 191, 89, 0.3);
    background: rgba(147, 103, 20, 0.16);
    color: #ffd58c;
  }

  .bracket-arrow {
    color: var(--muted);
    font-size: 1.2rem;
    flex-shrink: 0;
    padding-top: 20px;
  }

  .seed {
    color: var(--muted);
    font-size: 0.78rem;
  }

  @media (max-width: 480px) {
    .phase-item {
      grid-template-columns: 1fr;
    }
  }
</style>
