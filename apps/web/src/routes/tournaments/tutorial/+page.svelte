<section class="tutorial-page">
  <header class="hero">
    <a class="back-link" href="/tournaments">Back to Tournament</a>
    <h1 class="page-title">Telegram Bot Tutorial</h1>
    <p class="page-subtitle">
      Ikuti panduan ini untuk membuat event, mengelola ronde, menginput hasil match, dan menyelesaikan tournament dari bot Telegram.
    </p>
  </header>

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
      <li>Pilih <code>Total teams</code> dari tombol, atau kirim angka manual.</li>
      <li>Qualification rounds akan otomatis dipasang ke <code>8 rounds</code>.</li>
      <li>
        Pilih <code>Event date</code>:
        <ul>
          <li><code>Today</code></li>
          <li><code>Tomorrow</code></li>
          <li>atau kirim manual format <code>YYYY-MM-DD</code></li>
        </ul>
      </li>
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
      <li>
        Karena qualification sekarang memakai <code>BO2</code>, pilih salah satu:
        <ul>
          <li><code>Team A 2-0</code></li>
          <li><code>1-1 Draw</code></li>
          <li><code>Team B 2-0</code></li>
        </ul>
      </li>
      <li>Kalau salah input, gunakan <code>Reset Result</code>.</li>
      <li>Standings qualification akan menghitung poin dengan format <code>3 / 1 / 0</code>.</li>
      <li>Ulangi sampai semua match di ronde selesai.</li>
    </ol>
  </section>

  <section class="tutorial-card">
    <h2>5. Lanjut ke ronde berikutnya</h2>
    <ol>
      <li>Setelah semua game di ronde aktif selesai, tombol <code>Generate Next Round</code> akan muncul.</li>
      <li>Tekan tombol itu.</li>
      <li>Bot akan membuat pairing ronde berikutnya otomatis berdasarkan logic Swiss.</li>
      <li>Lalu ulangi proses input hasil game.</li>
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
