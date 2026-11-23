import type { LegalPack } from './types'

export const trLegal: LegalPack = {
  policy: {
    title: '{{APP_NAME}} İç Yönergesi',
    intro: 'Bu yönerge, {{COMPANY_NAME}} ("Şirket") çalışanlarının izin, masraf, avans, satın alma, seyahat ve zimmet işlemlerini {{APP_NAME}} paneli üzerinden nasıl yürüteceğini düzenler.',
    sections: [
      {
        h: '1. Kapsam',
        p: [
          'İzin, masraf, avans, satın alma ve seyahat talepleri ile şirkete ait ekipman ve yazılım hesaplarının zimmeti panel üzerinden yürütülür.',
          'Talepler panel üzerinden yapılır. Panele erişilemeyen durumlarda (hastalık, teknik arıza, acil durum) çalışan yöneticisine e-posta ya da telefonla bildirir; bildirim en kısa sürede panele işlenir. Bu yol, çalışanın kanundan doğan bildirim haklarını kısıtlamaz.',
        ],
      },
      {
        h: '2. Hesap ve giriş',
        p: [
          'Panele yalnızca çalışanın kendi iş e-posta adresiyle oluşturulan kişisel hesapla girilir. Hesap ve şifre kişiye özeldir, başkasıyla paylaşılmaz.',
          'Bir hesapla yapılan işlem, aksi ispat edilinceye kadar hesabın sahibi tarafından yapılmış kabul edilir. Hesabının başkası tarafından kullanıldığını fark eden çalışan şifresini değiştirir ve durumu hemen yöneticisine bildirir.',
        ],
      },
      {
        h: '3. Talepler ve onay',
        p: [
          'Talepler panelden açılır; onay ve ret kararları panelde verilir ve gerekçesiyle kayda geçer.',
          'Panelin gönderdiği e-postalar yalnızca bilgilendirme amaçlıdır; geçerli kayıt paneldeki kayıttır.',
        ],
      },
      {
        h: '4. Yıllık izin',
        p: [
          'Yıllık izin talepleri panelden yapılır; onaylanan izinler panelde izin kaydı olarak tutulur.',
          "Bir yıllık çalışma süresini henüz doldurmamış çalışana, talebi ve Şirket'in onayıyla, ileride hak edeceği yıllık izinden düşülmek üzere avans izin kullandırılabilir.",
          'Her çalışan, yıllık izin dökümünü yılda bir kez panelde kontrol edip onaylar. Dökümde hata gören çalışan onaylamaz, durumu yöneticisine bildirir; düzeltme yapıldıktan sonra onaylar. Onaylanmamış döküm onaylanmış sayılmaz.',
          'Yıl sonunda ve iş ilişkisi sona erdiğinde yıllık izin dökümü ayrıca yazılı olarak düzenlenip çalışana imzalatılır.',
        ],
      },
      {
        h: '5. Masraf ve avans',
        p: ['Masraf taleplerinde fiş ya da faturanın görüntüsü panele yüklenir. Belgenin aslı ayrıca muhasebeye teslim edilir; paneldeki görüntü aslın yerine geçmez.'],
      },
      {
        h: '6. Zimmet',
        p: [
          'Çalışana teslim edilen ekipman ve yazılım hesapları panelde zimmetlenir. Çalışan teslim aldığını panelde "Teslim aldım" ile onaylar; bu onay, ekipmanın seri numarası ve teslim tarihiyle birlikte teslimin delili olarak kullanılır.',
          'Çalışan zimmetindeki ekipmanı özenle kullanır; kaybını ya da hasarını gecikmeden bildirir. İş ilişkisi sona erdiğinde zimmetindeki her şeyi iade eder.',
          'Hasar ya da kayıp halinde sorumluluk ayrıca ve mevzuata uygun biçimde değerlendirilir. "Teslim aldım" onayı, ücretten kesinti yetkisi vermez.',
        ],
      },
      {
        h: '7. İzin Takvimi',
        p: [
          "Onaylanan izinler, iş planlaması amacıyla paneldeki İzin Takvimi'nde ad ve tarih olarak çalışmakta olan tüm çalışanlara görünür; gün içi izinlerde saat değil yalnızca \"yarım gün\" ya da \"birkaç saat\" yazar. İzin türü ve sebebi yalnızca yetkili yöneticilere görünür.",
          'Takvimden öğrenilen bilgi yalnızca iş planlaması için kullanılır. Çalışanlar bir meslektaşına iznin sebebini sormaz, sebebi tahmin edip başkalarıyla paylaşmaz ve takvimdeki bilgiyi panel dışına aktarmaz.',
        ],
      },
      {
        h: '8. Kayıtların niteliği',
        p: ['Paneldeki işlemler tarih, saat ve kullanıcı bilgisiyle kayıt altına alınır; bir kayıt üzerinde yapılan her değişiklik ayrıca kaydedilir. Bu kayıtlar, çalışanın imzaladığı Elektronik Kayıt ve İşlem Taahhütnamesi kapsamında, aksi ispat edilinceye kadar delil olarak kullanılabilir.'],
      },
      {
        h: '9. Yürürlük ve değişiklik',
        p: ["Yönerge ve güncellemeleri çalışanlara panelde sunulur. Çalışma koşullarında esaslı değişiklik içeren düzenlemeler, İş Kanunu'na uygun yazılı bildirimle yapılır."],
      },
    ],
  },
  privacy: {
    title: 'Çalışan Aydınlatma Metni — {{APP_NAME}}',
    intro: '6698 sayılı Kişisel Verilerin Korunması Kanunu ("KVKK") kapsamında veri sorumlusu {{COMPANY_NAME}} (Adres: {{COMPANY_ADDRESS}}; {{COMPANY_REGISTRATION}}) olarak, {{APP_NAME}} panelinde işlenen kişisel verilerin hakkında seni bilgilendiririz.',
    sections: [
      {
        h: '1. İşlenen veriler',
        p: [
          'Kimlik ve iletişim: ad soyad, iş e-posta adresi, görev, departman, rol ve dil tercihi.',
          'Hesap güvenliği: şifrenin geri döndürülemez biçimde özetlenmiş hali (şifrenin kendisi saklanmaz), oturum kayıtları, davet ve şifre sıfırlama bağlantılarının özetleri.',
          'Finans: masraf, avans ve seyahat ön ödemesi formlarında girilen bilgiler (ör. tutarlar ve varsa hesap numarası); bu bilgileri yalnızca sen ve yönetici rolündeki kullanıcılar görebilir, e-postalarda hesap numarası yer almaz.',
          'İş süreçleri: izin, masraf, avans, satın alma ve seyahat talepleri; bunlara eklenen belgeler; onay, ödeme ve avans kapatma kayıtları; zimmet ve yazılım hesabı bilgileri.',
          'Özel nitelikli veri: raporlu izinlerde yüklenen sağlık raporu. Bu belgeyi panelde yalnızca çalışanın kendisi ile yönetici rolündeki kullanıcılar görebilir; bildirim e-postalarında izin türü ve sağlık bilgisi yer almaz. Muhasebe e-postası etkinse, onaylanan raporlu iznin türü, tarihleri ve iş günü sayısı muhasebeye bildirilir; sağlık raporunun kendisi e-postayla gönderilmez.',
          "İzin Takvimi: onaylanan izinlerinin tarihleri adınla birlikte paneldeki İzin Takvimi'nde çalışmakta olan tüm çalışanlara görünür; izin türü, açıklama ve sağlık bilgisi görünmez; onay bekleyen, reddedilen ve iptal edilen izinler görünmez.",
          'İşler: Şirketin yaptığı işlerin kaydında (firma, iş adı, tarihler, durum) o işte çalışanların adı yer alır ve tüm çalışanlara görünür. İşin tutarı ve çalışanların işteki payı yalnızca yönetici rolündeki kullanıcılara görünür.',
          'İşlem güvenliği: giriş kayıtları, işlem zamanı, IP adresi ve tarayıcı bilgisi. E-postadaki bağlantıyla panele girmeden verilen onay ve ret kararlarında kararı verenin IP adresi ve tarayıcı bilgisi de denetim kaydına yazılır. Bu kayıtlar güvenlik, kötüye kullanımın tespiti ve ispat amacıyla tutulur; performans izleme için kullanılmaz.',
          'Veriler, panele senin girdiğin bilgilerden ve panelin işlem sırasında otomatik oluşturduğu kayıtlardan elektronik ortamda toplanır.',
        ],
      },
      {
        h: '2. Amaçlar',
        p: ['İzin, masraf, avans, satın alma ve seyahat süreçlerinin yürütülmesi; iş sözleşmesinden doğan yükümlülüklerin yerine getirilmesi; izin ve vergi mevzuatından doğan kayıt yükümlülükleri; şirket varlıklarının yönetimi; yapılan işlerin ve gelirin takibi; ekip içi iş planlaması; bilgi güvenliği ve uyuşmazlıklarda ispat.'],
      },
      {
        h: '3. Hukuki sebepler',
        p: [
          "KVKK m.5/2 kapsamında: iş sözleşmesinin kurulması ve ifası, hukuki yükümlülüğün yerine getirilmesi, bir hakkın tesisi, kullanılması veya korunması ve Şirket'in meşru menfaati.",
          'Sağlık raporunun işlenmesi, KVKK m.6/3 kapsamında iş ve sosyal güvenlik mevzuatından doğan yükümlülüklerin yerine getirilmesi amacıyla yapılır.',
          "İzin Takvimi'ndeki paylaşım, Şirket'in ekip içi iş planlamasına yönelik meşru menfaatine dayanır (KVKK m.5/2-f). Paneldeki \"okudum\" onayı rıza değil, bilgilendirildiğinin teyididir.",
        ],
      },
      {
        h: '4. Aktarım',
        p: [
          'Panel Cloudflare altyapısında barındırılır; verilerin tutulduğu bölge kurulumda seçilir. Bu durum KVKK m.9 kapsamında yurt dışına aktarım niteliği taşıyabilir ve mevzuatın öngördüğü güvencelerle yapılır.',
          "Panelin e-postaları Şirket'in seçtiği e-posta hizmet sağlayıcısı üzerinden gönderilir. Bildirim e-postalarında yalnızca talep türü, tarih ve tutar yer alır; sağlık bilgisi ve hesap numarası yer almaz.",
          "Muhasebe e-postası etkinse onaylanan izin, masraf ve avans talepleri ile onaylanan faturalar bordro, SGK ve muhasebe işlemleri için Şirket'in hizmet aldığı muhasebeye e-postayla iletilir.",
          'Onay bekleyen kayıtlar için onaylayıcıya giden e-postada, panele girmeden onay ya da ret verilebilen, yalnız o kayıt ve o kişi için geçerli, 7 gün süreli ve tek kullanımlık bir bağlantı bulunur.',
          'Ödemeler için gerekli bilgiler ödemeyi yapan bankayla; mevzuatın gerektirdiği bilgiler yetkili kamu kurumlarıyla paylaşılabilir.',
        ],
      },
      {
        h: '5. Saklama süresi',
        p: ['Veriler, iş ilişkisi süresince ve sona ermesinden itibaren mevzuatın öngördüğü süre boyunca saklanır. Süre sonunda silinir, yok edilir ya da anonim hale getirilir.'],
      },
      {
        h: '6. Hakların',
        p: [
          'KVKK m.11 kapsamında; verilerinin işlenip işlenmediğini öğrenme, işlenmişse bilgi isteme, işlenme amacını ve amaca uygun kullanılıp kullanılmadığını öğrenme, aktarıldığı kişileri bilme, eksik ya da yanlış işlenmişse düzeltilmesini, şartları oluştuğunda silinmesini ya da yok edilmesini isteme, otomatik sistemlerle analiz sonucu aleyhine bir sonuca itiraz etme ve kanuna aykırı işleme nedeniyle uğradığın zararın giderilmesini isteme haklarına sahipsin.',
          "Başvurunu Şirket adresine yazılı olarak ya da {{CONTACT_EMAIL}} adresine iletebilirsin. Başvurun en geç 30 gün içinde sonuçlandırılır; sonuçtan memnun kalmazsan Kişisel Verileri Koruma Kurulu'na şikâyette bulunabilirsin.",
        ],
      },
    ],
  },
  undertaking: {
    title: 'Elektronik Kayıt ve İşlem Taahhütnamesi',
    items: [
      'İzin, masraf, avans, satın alma, seyahat talepleri ile zimmet işlemlerinin {{COMPANY_NAME}} ("Şirket") tarafından {{APP_NAME}} paneli üzerinden yürütüldüğünü biliyorum.',
      'Panele yalnızca kendi kişisel hesabımla girerim, hesabımı ve şifremi kimseyle paylaşmam. Hesabımla yapılan işlemler bana aittir.',
      'Panelde yaptığım talepler ve verdiğim onaylar ("Teslim aldım", "Dökümüm doğrudur", belge onayları), panelde tutulan zaman ve kimlik kayıtlarıyla birlikte, bir uyuşmazlıkta aksi ispat edilinceye kadar delil olarak kullanılabilir. Kanunun yazılı şekil aradığı işlemler (ibra, fesih gibi) bu kapsamda değildir.',
      'Bu onaylar ibra niteliğinde değildir; kanundan doğan haklarım saklıdır.',
      'İç Yönerge ve Çalışan Aydınlatma Metni\'nin bana panelde sunulacağını, bunları okuyacağımı beyan ederim.',
      'Bu taahhütname iş ilişkisi süresince geçerlidir; kapsamı değişirse yeniden imzalanır. Bir örneği tarafıma verilmiştir.',
    ],
    signature: { name: 'Ad soyad', date: 'Tarih', sign: 'İmza', company: 'Şirket adına' },
  },
  labels: {
    policy: { label: 'İç yönerge', accusative: 'İç yönergeyi', ack: 'kabul ediyorum' },
    privacy: { label: 'Aydınlatma metni', accusative: 'Aydınlatma metnini', ack: 'bilgilendirildim' },
  },
}
