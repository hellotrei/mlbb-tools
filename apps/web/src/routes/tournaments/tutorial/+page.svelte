<section class="tutorial-page">
  <header class="hero">
    <a class="back-link" href="/tournaments">Back to Tournament</a>
    <h1 class="page-title">Draft Arena Telegram Bot</h1>
    <p class="page-subtitle">
      Ikuti panduan ini untuk membuat event, mengelola ronde, input hasil match, dan menjalankan tournament lewat bot Telegram Draft Arena, baik dari personal chat maupun group.
    </p>
  </header>

  <section class="tutorial-card">
    <h2>Before you start: tournament format</h2>
    <p>
      Bot Draft Arena sekarang mendukung 2 mode event, yaitu <strong>Regular Season</strong> dan <strong>Playoffs</strong>. Web tetap dipakai untuk melihat schedule, bracket, dan standings,
      sedangkan semua aksi admin tetap dikelola dari bot Telegram.
    </p>
    <ul>
      <li><strong>Bot scope:</strong> bot Draft Arena bisa dipakai di personal chat atau group Telegram yang berisi <strong>@mlbb_coach_bot</strong>.</li>
      <li><strong>Create event flow:</strong> admin mengisi nama event, tanggal <code>DD-MM-YYYY</code>, mode event, konfigurasi round/BO sesuai mode, jumlah tim, lalu nama tim.</li>
      <li><strong>Group sharing:</strong> creator bisa membuka event dari group untuk membagikan akses manage event ke member lain di group yang sama.</li>
      <li><strong>Result input model:</strong> semua skor diinput dari <strong>POV Team A</strong>, jadi admin cukup klik satu skor untuk match <code>Team A vs Team B</code>.</li>
      <li><strong>Regular Season formats:</strong> tersedia <code>Round Robin</code>, <code>Double Round Robin</code>, <code>5 Round</code>, dan <code>Custom Round</code>.</li>
      <li><strong>BO examples:</strong> <code>Regular Season BO1 -> 1-0 / Draw (20m+) / 0-1</code>, <code>BO2 -> 2-0 / 1-1 / 0-2</code>, <code>BO3 -> 2-0 / 2-1 / 1-2 / 0-2</code>, <code>BO5 -> 3-0 / 3-1 / 3-2 / 2-3 / 1-3 / 0-3</code>.</li>
      <li><strong>Standing points:</strong> <code>win = 1 point</code>, <code>draw = 0.5 point</code>, <code>loss = 0 point</code>, <code>bye = 1 point</code>.</li>
      <li><strong>BO rule of thumb:</strong> <code>BO</code> genap bisa berakhir draw, sedangkan <code>BO</code> ganjil harus menghasilkan pemenang.</li>
      <li><strong>Regular Season result:</strong> regular season selesai di klasemen, lalu <code>Top 4 teams advance to playoffs</code>. Tidak ada bracket semifinal/final internal di event regular season.</li>
      <li><strong>Generate next round:</strong> <code>Round Robin</code> dan <code>Double Round Robin</code> memakai jadwal tetap, sedangkan format fleksibel bisa memilih <code>Default Match</code> atau <code>Shuffle Match</code>.</li>
      <li><strong>Preview before confirm:</strong> untuk <code>5 Round</code>, <code>Custom Round</code>, dan <code>Playoffs</code>, bot akan menampilkan preview pairing lebih dulu sebelum round benar-benar dibuat.</li>
      <li><strong>Shuffle guard:</strong> saat memilih <code>Shuffle Match</code>, sistem akan mengacak ulang pairing sambil berusaha menghindari rematch berulang dan pair yang sudah bertemu 2x.</li>
      <li><strong>Ranking order:</strong> <code>Pts</code>, lalu <code>H2H</code>, lalu <code>Buchholz</code>, lalu <code>Pts Diff</code>, lalu statistik pendukung seperti <code>W/L/D/Bye</code>. Nilai <code>Pts Diff</code> positif sekarang tampil dengan tanda plus seperti <code>+3</code>, <code>+2</code>, atau <code>+1</code>.</li>
      <li><strong>Playoffs note:</strong> mode Playoffs sekarang punya BO terpisah untuk <code>early rounds</code>, <code>semifinal</code>, dan <code>final</code>.</li>
      <li><strong>Playoff web bracket:</strong> halaman web menampilkan connector bracket penuh dari <code>Knockout Stage</code> sampai <code>Final</code>, termasuk placeholder ronde berikutnya yang belum dimainkan.</li>
    </ul>
  </section>

  <section class="tutorial-card">
    <h2>1. Add bot</h2>
    <ol>
      <li>Buka Telegram.</li>
      <li>Cari bot Draft Arena di handle <strong>@mlbb_coach_bot</strong>, lalu tekan <code>Start</code>.</li>
      <li>Kalau ingin dipakai di group, tambahkan juga bot <strong>@mlbb_coach_bot</strong> ke group tersebut.</li>
      <li>Setelah bot ada di group, creator dan member di group yang sama bisa mengelola event yang sudah terscope ke group itu.</li>
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
    <h2>Group manage flow</h2>
    <ol>
      <li>Kalau event dibuat langsung dari group, event otomatis menjadi milik scope group tersebut.</li>
      <li>Creator tetap punya akses manage event itu.</li>
      <li>Member lain di group yang sama juga bisa membuka dan manage event tersebut dari bot.</li>
      <li>Kalau event awalnya dibuat di personal chat, creator bisa share event itu ke group dengan membuka <code>/view-event KODE_EVENT</code> dari group sekali saja.</li>
      <li>Setelah event berhasil dishare ke group, member group bisa lanjut pakai menu <code>View Event</code> untuk mengelola event yang sama.</li>
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
      <li>
        Kalau memilih <code>Regular Season</code>, pilih format:
        <ul>
          <li><code>Round Robin</code>: semua tim bertemu 1x</li>
          <li><code>Double Round Robin</code>: semua tim bertemu 2x dan pertemuan kedua langsung dibalik di ronde setelahnya, jadi kalau ronde ini <code>Team A vs Team B</code> maka ronde berikutnya menjadi <code>Team B vs Team A</code></li>
          <li><code>5 Round</code>: setiap tim cukup main 5 ronde, tidak wajib ketemu semua lawan</li>
          <li><code>Custom Round</code>: kirim manual jumlah ronde dari <code>1</code> sampai <code>10</code></li>
        </ul>
      </li>
      <li>Untuk <code>Regular Season</code>, pilih <code>Match Best Of</code> dari tombol <code>BO1</code>, <code>BO2</code>, <code>BO3</code>, atau kirim custom BO.</li>
      <li>Kalau pakai custom BO di regular season, ingat: <code>BO</code> genap bisa draw, sedangkan <code>BO</code> ganjil selalu menentukan pemenang.</li>
      <li>Untuk <code>Playoffs</code>, pilih <code>Best Of to Win</code> untuk early rounds, lalu pilih lagi <code>Semifinal BO</code> dan <code>Final BO</code>.</li>
      <li><code>Semifinal BO</code> hanya menyediakan <code>BO1</code>, <code>BO3</code>, atau <code>BO5</code>.</li>
      <li><code>Final BO</code> hanya menyediakan <code>BO3</code>, <code>BO5</code>, atau <code>BO7</code>.</li>
      <li>Pilih <code>Total teams</code> dari tombol <code>8</code>, <code>16</code>, <code>24</code>, atau kirim angka manual.</li>
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
      <li>Kalau event dibuat langsung dari group, event otomatis terscope ke group itu sehingga member group yang sama bisa ikut manage.</li>
    </ol>
  </section>

  <section class="tutorial-card">
    <h2>3. Lihat dan manage event</h2>
    <ol>
      <li>Pilih <code>View Event</code> atau ketik <code>/view-event</code>.</li>
      <li>Bot akan menampilkan daftar event yang Anda buat atau yang sudah dishare ke group tersebut.</li>
      <li>Kalau event awalnya dibuat di personal chat, creator bisa membuka event itu sekali dari group memakai <code>/view-event KODE_EVENT</code> untuk share akses manage ke group.</li>
      <li>Pilih event yang mau dikelola.</li>
      <li>
        Di menu event, Anda bisa:
        <ul>
          <li><code>View Standings</code></li>
          <li><code>View Schedule</code> untuk regular season atau <code>View Bracket</code> untuk playoffs</li>
          <li><code>Manage Round X</code></li>
          <li><code>Generate Next Round</code> jika masih ada ronde berikutnya</li>
          <li><code>Finish Event</code> jika ronde terakhir sudah selesai semua</li>
          <li><code>Delete Event</code> dengan konfirmasi ulang</li>
          <li><code>Open Web</code></li>
        </ul>
      </li>
      <li>Flow manage event ini berlaku juga saat event dibuka dari group yang sudah punya akses ke event tersebut.</li>
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
          <li><code>Regular Season BO1</code>: <code>Team A 1-0</code>, <code>Team A Draw (20m+)</code>, atau <code>Team A 0-1</code></li>
          <li><code>BO2</code>: <code>Team A 2-0</code>, <code>Team A 1-1</code>, atau <code>Team A 0-2</code></li>
          <li><code>BO3</code>: <code>Team A 2-0</code>, <code>Team A 2-1</code>, <code>Team A 1-2</code>, atau <code>Team A 0-2</code></li>
          <li><code>BO5</code>: <code>Team A 3-0</code>, <code>Team A 3-1</code>, <code>Team A 3-2</code>, <code>Team A 2-3</code>, <code>Team A 1-3</code>, atau <code>Team A 0-3</code></li>
        </ul>
      </li>
      <li>Kalau salah input, gunakan <code>Reset Result</code>.</li>
      <li>Untuk match standing, hasil win dihitung <code>1 poin</code>, draw <code>0.5 poin</code>, loss <code>0 poin</code>, dan <code>bye = 1 poin</code>.</li>
      <li>Khusus <code>Regular Season BO1</code>, admin boleh memilih <code>Draw (20m+)</code> bila match berakhir melewati 20 menit.</li>
      <li>Artinya, untuk <code>BO2</code> hasil <code>2-0 = win</code>, <code>1-1 = draw</code>, dan <code>0-2 = loss</code>.</li>
      <li>Di mode <code>Playoffs</code>, BO yang tampil saat input hasil otomatis mengikuti fase ronde aktif: early rounds, semifinal, atau final.</li>
      <li>Ulangi sampai semua match di ronde selesai.</li>
    </ol>
  </section>

  <section class="tutorial-card">
    <h2>5. Lanjut ke ronde berikutnya</h2>
    <ol>
      <li>Setelah semua match di ronde aktif selesai, tombol <code>Generate Next Round</code> akan muncul.</li>
      <li>Tekan tombol itu.</li>
      <li>Kalau format regular season adalah <code>Round Robin</code> atau <code>Double Round Robin</code>, bot akan langsung membuat ronde berikutnya dengan jadwal tetap.</li>
      <li>Kalau format regular season adalah <code>5 Round</code> atau <code>Custom Round</code>, atau event berjalan di mode <code>Playoffs</code>, bot akan menampilkan 2 pilihan pairing:
        <ul>
          <li><code>Default Match</code></li>
          <li><code>Shuffle Match</code></li>
        </ul>
      </li>
      <li><code>Default Match</code> akan menampilkan preview pairing ronde berikutnya mengikuti urutan/standing atau seed yang berlaku.</li>
      <li><code>Shuffle Match</code> akan menampilkan preview pairing acak sambil berusaha menghindari rematch berulang dan pair yang sudah bertemu 2x.</li>
      <li>Setelah preview muncul, admin bisa pilih <code>Confirm Pairings</code> atau <code>Shuffle Match Again</code> sampai pairing sesuai.</li>
      <li>Flow preview ini sudah berlaku dari round 1 untuk <code>5 Round</code>, <code>Custom Round</code>, dan <code>Playoffs</code>.</li>
      <li>Kalau ronde aktif adalah ronde terakhir dan semua match sudah selesai, tombolnya berubah menjadi <code>Finish Event</code>.</li>
      <li>Lalu ulangi proses input hasil match.</li>
    </ol>
  </section>

  <section class="tutorial-card">
    <h2>6. Selesaikan tournament</h2>
    <ol>
      <li>Kerjakan semua ronde sampai ronde terakhir selesai.</li>
      <li>Standings akan ter-update berdasarkan hasil match yang sudah masuk.</li>
      <li>Untuk <code>Regular Season</code>, hasil akhir yang dipakai adalah klasemen dan <code>Top 4 teams advance to playoffs</code>.</li>
      <li>Kalau event sudah tidak dipakai lagi, admin juga bisa memakai <code>Delete Event</code> dari menu manage event dan bot akan meminta konfirmasi sebelum benar-benar menghapus event.</li>
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
      <li>Pembuat event selalu bisa manage event. Member lain juga bisa manage kalau event itu sudah dishare ke group yang sama.</li>
      <li>Bot bisa dipakai di personal chat maupun di group, jadi manage event tidak harus selalu dilakukan lewat chat pribadi dengan bot.</li>
      <li>Untuk share event lama ke group, creator cukup buka event itu dari group dengan <code>/view-event KODE_EVENT</code> satu kali.</li>
      <li>Preset jumlah tim sekarang adalah <code>8</code>, <code>16</code>, dan <code>24</code>, tetapi tetap ada input custom.</li>
      <li>Untuk <code>Custom Round</code>, input ronde hanya menerima angka <code>1</code> sampai <code>10</code>.</li>
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
