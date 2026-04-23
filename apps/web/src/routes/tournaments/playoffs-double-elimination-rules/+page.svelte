<section class="rules-page">
  <header class="hero">
    <a class="back-link" href="/tournaments">← Kembali ke Tournament</a>
    <span class="breadcrumb-tag">Playoffs</span>
    <h1 class="page-title">Double Elimination</h1>
    <p class="page-subtitle">
      Format dua kesempatan. Tim baru benar-benar gugur setelah <strong>kalah dua kali</strong>. Ada jalur Upper Bracket dan Lower Bracket yang akhirnya bertemu di Grand Final.
    </p>
  </header>

  <section class="rules-card highlight-card">
    <h2>Ringkasan Format</h2>
    <div class="summary-grid">
      <div class="summary-item">
        <span class="summary-label">Gugur setelah</span>
        <span class="summary-value">2 kekalahan</span>
      </div>
      <div class="summary-item">
        <span class="summary-label">Jalur bracket</span>
        <span class="summary-value">Upper + Lower</span>
      </div>
      <div class="summary-item">
        <span class="summary-label">3rd Place Match</span>
        <span class="summary-value">Tidak ada</span>
      </div>
      <div class="summary-item">
        <span class="summary-label">Akhir bracket</span>
        <span class="summary-value">Grand Final</span>
      </div>
    </div>
  </section>

  <section class="rules-card">
    <h2>Cara Kerja</h2>
    <ul>
      <li>Semua tim mulai di <strong>Upper Bracket</strong>.</li>
      <li>Tim yang <strong>kalah di Upper Bracket</strong> tidak langsung gugur — mereka turun ke <strong>Lower Bracket</strong> untuk mendapat kesempatan kedua.</li>
      <li>Tim yang kalah di <strong>Lower Bracket</strong> baru benar-benar gugur dari kompetisi.</li>
      <li>Pemenang Upper Bracket dan pemenang Lower Bracket bertemu di <strong>Grand Final</strong>.</li>
      <li>Tidak ada laga Perebutan Juara 3 (3rd Place Match) di format ini karena posisi ke-3 otomatis jatuh ke tim yang kalah di Grand Final dari jalur Lower Bracket.</li>
    </ul>
  </section>

  <section class="rules-card">
    <h2>Struktur Bracket</h2>
    <div class="de-flow">
      <div class="de-lane">
        <span class="lane-badge upper-badge">Upper Bracket</span>
        <div class="lane-path">
          <span class="lane-step">Ronde 1</span>
          <span class="lane-sep">→</span>
          <span class="lane-step">Semi</span>
          <span class="lane-sep">→</span>
          <span class="lane-step">Final</span>
          <span class="lane-sep">→</span>
          <span class="lane-step dest">Grand Final</span>
        </div>
      </div>
      <div class="de-drop">↓ kalah → masuk Lower Bracket (1 kesempatan lagi)</div>
      <div class="de-lane">
        <span class="lane-badge lower-badge">Lower Bracket</span>
        <div class="lane-path">
          <span class="lane-step">LB R1</span>
          <span class="lane-sep">→</span>
          <span class="lane-step">LB R2</span>
          <span class="lane-sep">→</span>
          <span class="lane-step">LB Final</span>
          <span class="lane-sep">→</span>
          <span class="lane-step dest">Grand Final</span>
        </div>
      </div>
      <div class="de-elim">❌ Kalah di Lower Bracket = Gugur</div>
    </div>
    <div class="bracket-structure">
      <div class="bracket-lane upper">
        <h3>🏆 Upper Bracket</h3>
        <ul>
          <li>Semua tim mulai di sini.</li>
          <li>Menang → lanjut di Upper Bracket.</li>
          <li>Kalah → turun ke Lower Bracket (masih punya 1 kesempatan).</li>
          <li>Pemenang akhir Upper Bracket langsung ke <strong>Grand Final</strong>.</li>
        </ul>
      </div>
      <div class="bracket-lane lower">
        <h3>⚔️ Lower Bracket</h3>
        <ul>
          <li>Berisi tim yang sudah kalah sekali dari Upper Bracket.</li>
          <li>Menang → terus lanjut di Lower Bracket.</li>
          <li>Kalah → gugur total dari kompetisi.</li>
          <li>Pemenang akhir Lower Bracket langsung ke <strong>Grand Final</strong>.</li>
        </ul>
      </div>
    </div>
    <div class="grand-final-banner">
      <span class="gf-icon">🎯</span>
      <div>
        <strong>Grand Final</strong>
        <p>Pemenang Upper Bracket vs Pemenang Lower Bracket. Juara turnamen ditentukan di sini.</p>
      </div>
    </div>
  </section>

  <section class="rules-card">
    <h2>Konfigurasi Best-of (BO) per Fase</h2>
    <p class="section-note">Admin mengatur BO saat membuat event. BO berlaku untuk semua ronde di masing-masing jalur:</p>
    <div class="phase-list">
      <div class="phase-item">
        <div class="phase-label">Early Rounds (Upper)</div>
        <div class="phase-desc">Ronde awal di Upper Bracket. Biasanya BO1 atau BO3.</div>
      </div>
      <div class="phase-item">
        <div class="phase-label">Semifinal</div>
        <div class="phase-desc">Pilihan tersedia: <strong>BO1</strong>, <strong>BO3</strong>, atau <strong>BO5</strong>.</div>
      </div>
      <div class="phase-item">
        <div class="phase-label">Grand Final</div>
        <div class="phase-desc">Pilihan tersedia: <strong>BO3</strong>, <strong>BO5</strong>, atau <strong>BO7</strong>. Laga paling krusial di seluruh event.</div>
      </div>
    </div>
  </section>

  <section class="rules-card">
    <h2>Alur Playoffs</h2>
    <ol>
      <li>Admin membuat event Playoffs → pilih sub-mode <strong>Knockout Double Elimination</strong>.</li>
      <li>Pilih BO untuk early rounds, semifinal, dan Grand Final.</li>
      <li>Input jumlah tim dan nama tim (atau lanjut dari Regular Season dengan seeding otomatis).</li>
      <li>
        Sebelum memulai bracket, admin memilih <strong>Seeding Policy</strong>:
        <ul>
          <li><strong>Balanced</strong> – seeding merata antar slot (default)</li>
          <li><strong>Strict Rank</strong> – urutan penuh berdasarkan ranking akhir RS</li>
          <li><strong>Avoid Same Group</strong> – menghindari pertemuan tim dari group RS yang sama di babak awal</li>
        </ul>
      </li>
      <li>Bracket terbentuk. Ronde Upper Bracket pertama siap dimulai.</li>
      <li>Admin menginput hasil tiap match. Tim kalah turun ke Lower Bracket.</li>
      <li>Klik <strong>Generate Next Round</strong> untuk melanjutkan. Sistem otomatis memindahkan tim ke jalur yang benar.</li>
      <li>Lower Bracket terus berjalan bersamaan dengan Upper Bracket sampai masing-masing menyisakan satu pemenang.</li>
      <li>Grand Final dibuat antara pemenang Upper dan Lower Bracket.</li>
      <li>Juara ditentukan setelah Grand Final selesai.</li>
    </ol>
  </section>

  <section class="rules-card">
    <h2>Contoh Jalur Tim (8 Tim)</h2>
    <div class="example-table-wrap">
      <table class="example-table">
        <thead>
          <tr><th>Skenario</th><th>Ronde</th><th>Hasil</th><th>Status</th></tr>
        </thead>
        <tbody>
          <tr>
            <td>Tim A</td>
            <td>UB R1</td>
            <td>Menang</td>
            <td class="status-advance">Lanjut UB</td>
          </tr>
          <tr>
            <td>Tim B</td>
            <td>UB R1</td>
            <td>Kalah</td>
            <td class="status-lower">Turun ke LB</td>
          </tr>
          <tr>
            <td>Tim B</td>
            <td>LB R1</td>
            <td>Menang</td>
            <td class="status-advance">Lanjut LB</td>
          </tr>
          <tr>
            <td>Tim C</td>
            <td>LB R1</td>
            <td>Kalah</td>
            <td class="status-eliminated">Gugur</td>
          </tr>
          <tr>
            <td>Tim A</td>
            <td>UB Final</td>
            <td>Menang</td>
            <td class="status-gf">Grand Final (UB)</td>
          </tr>
          <tr>
            <td>Tim B</td>
            <td>LB Final</td>
            <td>Menang</td>
            <td class="status-gf">Grand Final (LB)</td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>

  <section class="rules-card">
    <h2>Fitur Grand Final Info</h2>
    <ul>
      <li>Saat Grand Final sudah terbentuk, tombol <strong>🎬 Set Grand Final Info</strong> muncul di bot.</li>
      <li>Admin bisa mengirim:
        <ul>
          <li>URL logo Tim A</li>
          <li>URL logo Tim B</li>
          <li>URL YouTube live stream</li>
        </ul>
      </li>
      <li>Semua field bersifat opsional — kirim <code>skip</code> untuk melewati field yang tidak diperlukan.</li>
      <li>Informasi ini akan ditampilkan di halaman web event untuk memperindah tampilan Grand Final.</li>
    </ul>
  </section>

  <section class="rules-card">
    <h2>Tampilan Web</h2>
    <ul>
      <li>Double Elimination ditampilkan sebagai <strong>daftar round berlabel</strong> (bukan konektor bracket penuh) di halaman web.</li>
      <li>Setiap ronde dilabeli dengan fase-nya: <em>Upper Bracket Round X</em>, <em>Lower Bracket Round X</em>, hingga <em>Grand Final</em>.</li>
      <li>Bracket bisa langsung dibagikan ke peserta melalui tombol <strong>Open Web</strong> di bot.</li>
    </ul>
  </section>

  <section class="rules-card">
    <h2>Perbedaan dengan Single Elimination</h2>
    <div class="comparison">
      <div class="comparison-col">
        <h3>Single Elimination</h3>
        <ul>
          <li>Gugur setelah 1 kalah</li>
          <li>Bracket lebih simpel</li>
          <li>Selesai lebih cepat</li>
          <li>Ada opsi 3rd Place Match</li>
        </ul>
      </div>
      <div class="comparison-col highlighted">
        <h3>Double Elimination</h3>
        <ul>
          <li>Gugur setelah 2 kalah</li>
          <li>Ada Upper & Lower Bracket</li>
          <li>Lebih banyak match</li>
          <li>Lebih adil untuk semua tim</li>
        </ul>
      </div>
    </div>
  </section>

  <section class="rules-card">
    <h2>Tips</h2>
    <ul>
      <li>Double Elimination lebih adil karena satu kekalahan di awal tidak langsung mematikan peluang tim.</li>
      <li>Format ini ideal untuk turnamen yang ingin memberi "kesempatan kedua" — misalnya event komunitas di mana pengalaman bermain lebih banyak dihargai.</li>
      <li>Pastikan ada cukup waktu karena jumlah total match lebih banyak dibanding Single Elimination.</li>
      <li>Gunakan BO3 atau BO5 di Grand Final untuk memaksimalkan drama kompetisi.</li>
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

  .de-flow {
    display: grid;
    gap: 6px;
    padding: 14px;
    background: rgba(255, 255, 255, 0.02);
    border: 1px solid rgba(123, 220, 255, 0.1);
    border-radius: 12px;
    margin-bottom: 16px;
  }

  .de-lane {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
  }

  .lane-badge {
    font-size: 0.75rem;
    font-weight: 700;
    padding: 3px 8px;
    border-radius: 5px;
    white-space: nowrap;
    flex-shrink: 0;
    min-width: 100px;
    text-align: center;
  }

  .upper-badge {
    background: rgba(123, 220, 255, 0.12);
    color: #7bdcff;
    border: 1px solid rgba(123, 220, 255, 0.25);
  }

  .lower-badge {
    background: rgba(255, 168, 80, 0.12);
    color: #ffa850;
    border: 1px solid rgba(255, 168, 80, 0.25);
  }

  .lane-path {
    display: flex;
    align-items: center;
    gap: 5px;
    flex-wrap: wrap;
  }

  .lane-step {
    background: rgba(9, 18, 34, 0.8);
    border: 1px solid rgba(123, 220, 255, 0.15);
    border-radius: 6px;
    padding: 3px 8px;
    font-size: 0.8rem;
    color: var(--text);
  }

  .lane-step.dest {
    background: rgba(80, 200, 120, 0.1);
    border-color: rgba(80, 200, 120, 0.3);
    color: #50c878;
    font-weight: 700;
  }

  .lane-sep {
    color: var(--muted);
    font-size: 0.75rem;
  }

  .de-drop {
    text-align: center;
    font-size: 0.8rem;
    color: var(--muted);
    font-style: italic;
    padding: 2px 0;
  }

  .de-elim {
    text-align: center;
    font-size: 0.82rem;
    color: #ff7b7b;
    padding: 5px 10px;
    background: rgba(255, 80, 80, 0.07);
    border-radius: 6px;
    border: 1px solid rgba(255, 80, 80, 0.18);
  }

  .bracket-structure {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 10px;
  }

  .bracket-lane {
    border-radius: 12px;
    padding: 12px;
    display: grid;
    gap: 8px;
  }

  .bracket-lane.upper {
    background: rgba(20, 110, 74, 0.14);
    border: 1px solid rgba(103, 222, 160, 0.2);
  }

  .bracket-lane.lower {
    background: rgba(23, 93, 129, 0.14);
    border: 1px solid rgba(102, 213, 255, 0.2);
  }

  .bracket-lane h3 {
    font-size: 0.88rem;
    margin: 0;
  }

  .bracket-lane ul {
    padding-left: 16px;
    font-size: 0.84rem;
    gap: 6px;
  }

  .grand-final-banner {
    display: flex;
    gap: 12px;
    align-items: center;
    background: rgba(147, 103, 20, 0.18);
    border: 1px solid rgba(255, 191, 89, 0.28);
    border-radius: 12px;
    padding: 12px 14px;
  }

  .gf-icon {
    font-size: 1.5rem;
    flex-shrink: 0;
  }

  .grand-final-banner strong {
    display: block;
    margin-bottom: 4px;
    color: #ffd58c;
  }

  .grand-final-banner p {
    color: var(--muted);
    font-size: 0.86rem;
    margin: 0;
    line-height: 1.4;
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
    grid-template-columns: 170px 1fr;
    gap: 10px;
    align-items: start;
    padding: 10px 12px;
    background: rgba(255, 255, 255, 0.03);
    border-radius: 10px;
    border-left: 3px solid rgba(123, 220, 255, 0.3);
  }

  .phase-label {
    font-size: 0.88rem;
    font-weight: 600;
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

  .example-table-wrap {
    overflow-x: auto;
  }

  .example-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.88rem;
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
    font-size: 0.8rem;
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }

  .status-advance { color: #9ee7ff; font-weight: 600; }
  .status-lower { color: #ffd58c; font-weight: 600; }
  .status-eliminated { color: #ff9c9c; font-weight: 600; }
  .status-gf { color: #9cffbf; font-weight: 600; }

  .comparison {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 12px;
  }

  .comparison-col {
    background: rgba(255, 255, 255, 0.03);
    border-radius: 10px;
    padding: 12px;
  }

  .comparison-col.highlighted {
    background: rgba(12, 28, 56, 0.6);
    border: 1px solid rgba(123, 220, 255, 0.2);
  }

  .comparison-col h3 {
    font-size: 0.88rem;
    margin: 0 0 8px;
  }

  .comparison-col ul {
    padding-left: 16px;
    font-size: 0.86rem;
  }

  code {
    font-size: 0.9em;
  }

  @media (max-width: 560px) {
    .bracket-structure {
      grid-template-columns: 1fr;
    }

    .comparison {
      grid-template-columns: 1fr;
    }

    .phase-item {
      grid-template-columns: 1fr;
    }
  }
</style>
