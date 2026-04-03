<section class="tutorial-page">
  <header class="hero">
    <a class="back-link" href="/tournaments">Back to Tournament</a>
    <h1 class="page-title">Telegram Bot Tutorial</h1>
    <p class="page-subtitle">
      Ikuti panduan ini untuk membuat event, mengelola ronde, menginput hasil match, dan menyelesaikan tournament dari bot Telegram.
    </p>
  </header>

  <section class="tutorial-card">
    <h2>Before you start: tournament format</h2>
    <p>
      Sistem bot sekarang mendukung 2 mode event, yaitu <strong>Regular Season</strong> dan <strong>Playoffs</strong>. Web tetap dipakai untuk melihat bracket dan standings,
      sedangkan semua aksi admin tetap dikelola dari bot Telegram.
    </p>
    <ul>
      <li><strong>Create event flow:</strong> admin mengisi nama event, tanggal <code>DD-MM-YYYY</code>, mode event, Match Best Of, jumlah tim, lalu nama tim.</li>
      <li><strong>Result input model:</strong> semua skor diinput dari <strong>POV Team A</strong>, jadi admin cukup klik satu skor untuk match <code>Team A vs Team B</code>.</li>
      <li><strong>BO examples:</strong> <code>BO1 -> 1-0 / 0-1</code>, <code>BO2 -> 2-0 / 1-1 / 0-2</code>, <code>BO3 -> 2-0 / 2-1 / 1-2 / 0-2</code>, <code>BO5 -> 3-0 / 3-1 / 3-2 / 2-3 / 1-3 / 0-3</code>.</li>
      <li><strong>Standing points:</strong> <code>win = 3 points</code>, <code>draw = 1 point</code>, <code>loss = 0 point</code>, <code>bye = 3 points</code>.</li>
      <li><strong>BO rule of thumb:</strong> <code>BO</code> genap bisa berakhir draw, sedangkan <code>BO</code> ganjil harus menghasilkan pemenang.</li>
      <li><strong>Generate next round:</strong> pairing ronde berikutnya sekarang default memakai <code>Shuffle Match</code>.</li>
      <li><strong>Shuffle guard:</strong> sistem akan mengacak ulang pairing sambil berusaha menghindari rematch berulang dan pair yang sudah bertemu 2x.</li>
      <li><strong>Ranking order:</strong> <code>Score</code>, lalu <code>H2H</code>, lalu <code>Buchholz</code>, lalu <code>Pts Diff</code>, lalu statistik pendukung seperti <code>W/L/D/Bye</code>.</li>
      <li><strong>Playoffs note:</strong> mode Playoffs tetap disimpan di event, tetapi standings poin <code>3 / 1 / 0</code> dipakai untuk match yang masuk ke tabel standing.</li>
    </ul>
  </section>

  <section class="tutorial-card">
    <h2>1. Add bot</h2>
    <ol>
      <li>Buka Telegram.</li>
      <li>Cari bot <strong>@mlbb_coach_bot</strong>, lalu tekan <code>Start</code>.</li>
      <li>
        Setelah <code>/start</code>, bot akan menampilkan 2 menu utama:
        <ul>
          <li><code>Create New Event</code></li>
          <li><code>View Event</code></li>
        </ul>
      </li>
    </ol>
  </section>

  <section class="tutorial-card">
    <h2>2. Buat tournament baru</h2>
    <ol>
      <li>Pilih <code>Create New Event</code> atau ketik <code>/create-new-event</code>.</li>
      <li>Isi <code>Tournament name</code>.</li>
      <li>Isi <code>Event date</code> manual dengan format <code>DD-MM-YYYY</code>.</li>
      <li>
        Pilih <code>mode event</code>:
        <ul>
          <li><code>Regular Season</code></li>
          <li><code>Playoffs</code></li>
        </ul>
      </li>
      <li>Pilih <code>Match Best Of</code> dari tombol <code>BO1</code>, <code>BO2</code>, <code>BO3</code>, atau kirim custom BO.</li>
      <li>Kalau pakai custom BO, ingat: <code>BO</code> genap bisa draw, sedangkan <code>BO</code> ganjil selalu menentukan pemenang.</li>
      <li>Pilih <code>Total teams</code> dari tombol, atau kirim angka manual.</li>
      <li>Untuk <code>Regular Season</code>, jumlah tim harus genap. Untuk <code>Playoffs</code>, jumlah tim boleh ganjil atau genap.</li>
      <li>
        Kirim <code>team names</code> sesuai jumlah tim.
        Format paling mudah: satu nama tim per baris.
      </li>
      <li>
        Bot akan menampilkan review daftar tim:
        <ul>
          <li><code>Looks Good</code> untuk lanjut</li>
          <li><code>Re-enter Teams</code> untuk ulang</li>
        </ul>
      </li>
      <li>
        Di halaman konfirmasi, Anda bisa:
        <ul>
          <li><code>Confirm</code></li>
          <li><code>Edit Name</code></li>
          <li><code>Edit Date</code></li>
          <li><code>Edit Mode</code></li>
          <li><code>Edit Match BO</code></li>
          <li><code>Edit Teams Count</code></li>
          <li><code>Edit Team Names</code></li>
          <li><code>Cancel</code></li>
        </ul>
      </li>
      <li>
        Setelah <code>Confirm</code>, event dibuat dan bot akan memberi:
        <ul>
          <li>kode event</li>
          <li>akses manage event</li>
          <li>tombol <code>Open Web</code></li>
        </ul>
      </li>
    </ol>
  </section>

  <section class="tutorial-card">
    <h2>3. Lihat dan manage event</h2>
    <ol>
      <li>Pilih <code>View Event</code> atau ketik <code>/view-event</code>.</li>
      <li>Bot akan menampilkan daftar event yang Anda buat.</li>
      <li>Pilih event yang mau dikelola.</li>
      <li>
        Di menu event, Anda bisa:
        <ul>
          <li><code>View Standings</code></li>
          <li><code>View Bracket</code></li>
          <li><code>Manage Round X</code></li>
          <li><code>Generate Next Round</code> jika ronde aktif sudah selesai</li>
          <li><code>Open Web</code></li>
        </ul>
      </li>
    </ol>
  </section>

  <section class="tutorial-card">
    <h2>4. Input hasil pertandingan</h2>
    <ol>
      <li>Masuk ke <code>Manage Round X</code>.</li>
      <li>Bot akan menampilkan daftar match di ronde itu.</li>
      <li>Pilih match yang ingin diinput.</li>
      <li>Semua pilihan skor ditampilkan dari <code>POV Team A</code>. Jadi kalau match-nya <code>Team A vs Team B</code>, admin cukup pilih hasil untuk <code>Team A</code>.</li>
      <li>
        Contoh pilihan result:
        <ul>
          <li><code>BO1</code>: <code>Team A 1-0</code> atau <code>Team A 0-1</code></li>
          <li><code>BO2</code>: <code>Team A 2-0</code>, <code>Team A 1-1</code>, atau <code>Team A 0-2</code></li>
          <li><code>BO3</code>: <code>Team A 2-0</code>, <code>Team A 2-1</code>, <code>Team A 1-2</code>, atau <code>Team A 0-2</code></li>
          <li><code>BO5</code>: <code>Team A 3-0</code>, <code>Team A 3-1</code>, <code>Team A 3-2</code>, <code>Team A 2-3</code>, <code>Team A 1-3</code>, atau <code>Team A 0-3</code></li>
        </ul>
      </li>
      <li>Kalau salah input, gunakan <code>Reset Result</code>.</li>
      <li>Untuk match standing, hasil win dihitung <code>3 poin</code>, draw <code>1 poin</code>, loss <code>0 poin</code>, dan <code>bye = 3 poin</code>.</li>
      <li>Artinya, untuk <code>BO2</code> hasil <code>2-0 = win</code>, <code>1-1 = draw</code>, dan <code>0-2 = loss</code>.</li>
      <li>Ulangi sampai semua match di ronde selesai.</li>
    </ol>
  </section>

  <section class="tutorial-card">
    <h2>5. Lanjut ke ronde berikutnya</h2>
    <ol>
      <li>Setelah semua match di ronde aktif selesai, tombol <code>Generate Next Round</code> akan muncul.</li>
      <li>Tekan tombol itu.</li>
      <li>Bot akan membuat pairing ronde berikutnya otomatis dengan <code>Shuffle Match</code>.</li>
      <li>Lalu ulangi proses input hasil match.</li>
    </ol>
  </section>

  <section class="tutorial-card">
    <h2>6. Selesaikan tournament</h2>
    <ol>
      <li>Kerjakan semua ronde sampai ronde terakhir selesai.</li>
      <li>Standings akan ter-update berdasarkan hasil match yang sudah masuk.</li>
      <li>
        Anda bisa cek hasil akhir dari:
        <ul>
          <li><code>View Standings</code> di bot</li>
          <li>halaman web lewat <code>Open Web</code></li>
        </ul>
      </li>
    </ol>
  </section>

  <section class="tutorial-card">
    <h2>Catatan penting</h2>
    <ul>
      <li>Hanya pembuat event yang bisa manage event tersebut.</li>
      <li>Jumlah <code>team names</code> harus sama persis dengan <code>total teams</code>.</li>
      <li>Nama tim harus unik.</li>
      <li>Kalau ingin membatalkan flow yang sedang berjalan, gunakan <code>/cancel</code>.</li>
    </ul>
  </section>
</section>

<style>
  .tutorial-page {
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
  }

  .tutorial-card {
    border: 1px solid rgba(123, 220, 255, 0.14);
    border-radius: 16px;
    background: rgba(9, 18, 34, 0.6);
    padding: 16px;
  }

  .tutorial-card h2 {
    margin: 0 0 12px;
    font-size: 1rem;
  }

  .tutorial-card ol,
  .tutorial-card ul {
    margin: 0;
    padding-left: 20px;
    color: var(--muted);
    display: grid;
    gap: 8px;
  }

  .tutorial-card li {
    line-height: 1.5;
  }

  code {
    font-size: 0.92em;
  }
</style>
