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
    <p class="variant-intro">Swiss Stage mendukung <strong>3 ukuran event</strong>. Pilih sesuai jumlah tim yang didaftarkan:</p>
    <div class="variant-table-wrap">
      <table class="variant-table">
        <thead>
          <tr>
            <th>Jumlah Tim</th>
            <th>Maks Ronde</th>
            <th>Win Threshold</th>
            <th>Loss Threshold</th>
            <th>Tim Lolos</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td><strong>8 tim</strong></td>
            <td>3 ronde</td>
            <td>2 kemenangan ✅</td>
            <td>2 kekalahan ❌</td>
            <td>Top 4</td>
          </tr>
          <tr>
            <td><strong>16 tim</strong></td>
            <td>5 ronde</td>
            <td>3 kemenangan ✅</td>
            <td>3 kekalahan ❌</td>
            <td>Top 8</td>
          </tr>
          <tr>
            <td><strong>32 tim</strong></td>
            <td>5 ronde</td>
            <td>3 kemenangan ✅</td>
            <td>3 kekalahan ❌</td>
            <td>Top 16</td>
          </tr>
        </tbody>
      </table>
    </div>
    <div class="summary-grid" style="margin-top:12px">
      <div class="summary-item">
        <span class="summary-label">Match biasa</span>
        <span class="summary-value">BO1</span>
      </div>
      <div class="summary-item">
        <span class="summary-label">Match penentuan (decider)</span>
        <span class="summary-value">BO3</span>
      </div>
    </div>
  </section>

  <section class="rules-card">
    <h2>Cara Kerja</h2>
    <ul>
      <li>Setiap ronde, tim yang memiliki <strong>poin (skor) sama</strong> saling dipertemukan. Sistem otomatis mengelompokkan pairing berdasarkan catatan menang/kalah.</li>
      <li>Tidak ada eliminasi langsung seperti knockout. Setiap tim terus bermain sampai mencapai kondisi lolos atau gugur.</li>
      <li>Tim yang sudah mencapai <strong>win threshold</strong> langsung lolos (qualify) ke fase berikutnya: <strong>2 kemenangan</strong> untuk 8 tim, <strong>3 kemenangan</strong> untuk 16/32 tim.</li>
      <li>Tim yang sudah mencapai <strong>loss threshold</strong> langsung tersingkir (eliminate): <strong>2 kekalahan</strong> untuk 8 tim, <strong>3 kekalahan</strong> untuk 16/32 tim.</li>
      <li>Setelah Swiss selesai, <strong>Top 50%</strong> dari seluruh peserta lanjut ke fase Playoffs (Top 4 dari 8 tim, Top 8 dari 16 tim, Top 16 dari 32 tim).</li>
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

    <h3 class="variant-heading">16 / 32 Tim — 5 Ronde (3W / 3L)</h3>
    <div class="swiss-flow">
      <div class="sf-col">
        <div class="sf-round-label">R1</div>
        <div class="sf-group neutral">16/32 tim<br><small>Acak / Default</small></div>
      </div>
      <div class="sf-arrow">→</div>
      <div class="sf-col">
        <div class="sf-round-label">R2</div>
        <div class="sf-group win">1W vs 1W</div>
        <div class="sf-group lose">0W vs 0W</div>
      </div>
      <div class="sf-arrow">→</div>
      <div class="sf-col">
        <div class="sf-round-label">R3</div>
        <div class="sf-group lolos">2-0 vs 2-0</div>
        <div class="sf-group mid">1-1 lanjut</div>
        <div class="sf-group gugur">0-2 vs 0-2</div>
      </div>
      <div class="sf-arrow">→</div>
      <div class="sf-col">
        <div class="sf-round-label">R4–5</div>
        <div class="sf-badge lolos-badge">3W ✅ Lolos</div>
        <div class="sf-group mid">sisa lanjut</div>
        <div class="sf-badge gugur-badge">3L ❌ Gugur</div>
      </div>
    </div>
    <p class="swiss-flow-note">Top 8 (dari 16 tim) atau Top 16 (dari 32 tim) → Playoffs</p>

    <h3 class="variant-heading" style="margin-top:20px">8 Tim — 3 Ronde (2W / 2L)</h3>
    <div class="swiss-flow">
      <div class="sf-col">
        <div class="sf-round-label">R1</div>
        <div class="sf-group neutral">8 tim<br><small>Acak / Default</small></div>
      </div>
      <div class="sf-arrow">→</div>
      <div class="sf-col">
        <div class="sf-round-label">R2</div>
        <div class="sf-group lolos">1-0 vs 1-0</div>
        <div class="sf-group gugur">0-1 vs 0-1</div>
      </div>
      <div class="sf-arrow">→</div>
      <div class="sf-col">
        <div class="sf-round-label">R3</div>
        <div class="sf-badge lolos-badge">2W ✅ Lolos</div>
        <div class="sf-group mid">1-1 decider</div>
        <div class="sf-badge gugur-badge">2L ❌ Gugur</div>
      </div>
    </div>
    <p class="swiss-flow-note">Top 4 dari 8 tim → Playoffs</p>

    <ol>
      <li>Ronde 1 bisa memakai <em>Default Match</em> (berdasarkan seed) atau <em>Shuffle Match</em> (acak).</li>
      <li>Setiap ronde berikutnya, sistem otomatis mengelompokkan pairing berdasarkan skor yang sama.</li>
      <li>Jika ada tim yang poinnya ganjil di satu grup (tidak bisa dipasangkan), satu tim mendapat <strong>bye</strong> (menang otomatis 1 poin).</li>
      <li>Setelah ronde selesai, kondisi setiap tim dicek:
        <ul>
          <li>Capai win threshold → otomatis <strong>lolos</strong>, tidak perlu main lagi</li>
          <li>Capai loss threshold → otomatis <strong>gugur</strong>, tidak perlu main lagi</li>
        </ul>
      </li>
      <li>Proses berlanjut hingga maksimal ronde habis atau semua tim sudah ditentukan nasibnya.</li>
    </ol>
  </section>

  <section class="rules-card">
    <h2>Contoh Jalur Tim</h2>

    <h3 class="variant-heading">16 / 32 Tim (3W / 3L)</h3>
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

    <h3 class="variant-heading" style="margin-top:16px">8 Tim (2W / 2L)</h3>
    <div class="example-table-wrap">
      <table class="example-table">
        <thead>
          <tr><th>Setelah Ronde</th><th>Catatan Tim</th><th>Status</th></tr>
        </thead>
        <tbody>
          <tr><td>Ronde 2</td><td>2W - 0L</td><td class="status-qualify">✅ Lolos</td></tr>
          <tr><td>Ronde 2</td><td>0W - 2L</td><td class="status-eliminated">❌ Gugur</td></tr>
          <tr><td>Ronde 3</td><td>2W - 1L</td><td class="status-qualify">✅ Lolos</td></tr>
          <tr><td>Ronde 3</td><td>1W - 2L</td><td class="status-eliminated">❌ Gugur</td></tr>
        </tbody>
      </table>
    </div>
    <p class="note">Match di Ronde 3 antara tim 1-1 vs 1-1 menggunakan BO3 (match penentuan).</p>
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
      <li>Pilih <strong>8 tim</strong> untuk event kecil — cukup 3 ronde, selesai cepat, tetap kompetitif.</li>
      <li>Pilih <strong>16 tim</strong> untuk event reguler — 5 ronde memberikan hasil yang representatif.</li>
      <li>Pilih <strong>32 tim</strong> untuk event besar — cocok untuk open tournament dengan banyak pendaftar.</li>
      <li>Karena pairing berdasarkan skor yang sama, tim kuat cenderung bertemu tim kuat — Top 50% yang lolos benar-benar merepresentasikan tim terbaik.</li>
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

  .swiss-flow {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    flex-wrap: wrap;
    padding: 14px;
    background: rgba(255, 255, 255, 0.02);
    border: 1px solid rgba(123, 220, 255, 0.1);
    border-radius: 12px;
    margin-bottom: 14px;
  }

  .sf-col {
    display: grid;
    gap: 5px;
    min-width: 80px;
  }

  .sf-round-label {
    font-size: 0.75rem;
    font-weight: 700;
    color: var(--muted);
    text-align: center;
    padding-bottom: 2px;
    border-bottom: 1px solid rgba(123, 220, 255, 0.12);
  }

  .sf-group {
    font-size: 0.76rem;
    padding: 4px 7px;
    border-radius: 6px;
    text-align: center;
    line-height: 1.3;
  }

  .sf-group small {
    display: block;
    font-size: 0.7rem;
    opacity: 0.7;
  }

  .sf-group.neutral {
    background: rgba(123, 220, 255, 0.08);
    border: 1px solid rgba(123, 220, 255, 0.15);
    color: var(--text);
  }

  .sf-group.win {
    background: rgba(80, 200, 120, 0.08);
    border: 1px solid rgba(80, 200, 120, 0.2);
    color: #50c878;
  }

  .sf-group.lose {
    background: rgba(255, 80, 80, 0.07);
    border: 1px solid rgba(255, 80, 80, 0.15);
    color: #ff7b7b;
  }

  .sf-group.lolos {
    background: rgba(80, 200, 120, 0.08);
    border: 1px solid rgba(80, 200, 120, 0.2);
    color: #50c878;
  }

  .sf-group.mid {
    background: rgba(255, 200, 80, 0.07);
    border: 1px solid rgba(255, 200, 80, 0.15);
    color: #ffc850;
  }

  .sf-group.gugur {
    background: rgba(255, 80, 80, 0.07);
    border: 1px solid rgba(255, 80, 80, 0.15);
    color: #ff7b7b;
  }

  .sf-badge {
    font-size: 0.76rem;
    font-weight: 700;
    padding: 4px 7px;
    border-radius: 6px;
    text-align: center;
  }

  .lolos-badge {
    background: rgba(80, 200, 120, 0.12);
    border: 1px solid rgba(80, 200, 120, 0.3);
    color: #50c878;
  }

  .gugur-badge {
    background: rgba(255, 80, 80, 0.1);
    border: 1px solid rgba(255, 80, 80, 0.25);
    color: #ff7b7b;
  }

  .sf-arrow {
    color: var(--muted);
    font-size: 1rem;
    align-self: center;
    padding-top: 20px;
  }

  .swiss-flow-note {
    font-size: 0.82rem;
    color: var(--muted);
    text-align: center;
    margin: 0 0 12px;
    font-style: italic;
  }

  .variant-intro {
    font-size: 0.92rem;
    color: var(--muted);
    margin: 0 0 12px;
  }

  .variant-heading {
    font-size: 0.85rem;
    font-weight: 700;
    color: var(--muted);
    text-transform: uppercase;
    letter-spacing: 0.05em;
    margin: 0 0 10px;
    padding-left: 2px;
    border-left: 3px solid rgba(123, 220, 255, 0.3);
    padding-left: 8px;
  }

  .variant-table-wrap {
    overflow-x: auto;
  }

  .variant-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.85rem;
  }

  .variant-table th {
    text-align: left;
    padding: 7px 10px;
    color: var(--muted);
    font-weight: 600;
    border-bottom: 1px solid rgba(123, 220, 255, 0.12);
    white-space: nowrap;
  }

  .variant-table td {
    padding: 7px 10px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.04);
    color: var(--text);
  }

  .variant-table tr:last-child td {
    border-bottom: none;
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
