// eslint-disable-next-line no-unused-vars
/* global systemDictionary:true */
/* jshint node: true */
'use strict';

systemDictionary = {
    'artnet-recorder adapter settings': {
        'en': 'Adapter settings for artnet-recorder',
        'de': 'Adaptereinstellungen für artnet-recorder',
        'ru': 'Настройки адаптера для артнет-рекордера',
        'pt': 'Configurações do adaptador para gravador artnet',
        'nl': 'Adapterinstellingen voor artnet-recorder',
        'fr': 'Paramètres de l\'adaptateur pour l\'enregistreur artnet',
        'it': 'Impostazioni dell\'adattatore per il registratore artnet',
        'es': 'Configuración del adaptador para artnet-recorder',
        'pl': 'Ustawienia adaptera dla rejestratora artnet',
        'zh-cn': 'artnet-recorder 的适配器设置'
    },
    'bind': {
        'en': 'IP address to bind the port to',
        'de': 'IP-Adresse, an die der Port gebunden werden soll',
        'ru': 'IP-адрес для привязки порта к',
        'pt': 'Endereço IP para ligar a porta',
        'nl': 'IP-adres om de poort aan te binden',
        'fr': 'Adresse IP à laquelle lier le port',
        'it': 'Indirizzo IP a cui associare la porta',
        'es': 'Dirección IP para vincular el puerto',
        'pl': 'Adres IP, z którym ma zostać powiązany port',
        'zh-cn': '绑定端口的IP地址'
    },
    'net': {
        'en': 'the net ID',
        'de': 'die Netz-ID',
        'ru': 'сетевой идентификатор',
        'pt': 'o ID da rede',
        'nl': 'de net-ID',
        'fr': 'l\'identifiant du réseau',
        'it': 'l\'ID netto',
        'es': 'la identificación neta',
        'pl': 'identyfikator sieci',
        'zh-cn': '网络ID'
    },
    'subNet': {
        'en': 'the sub net ID',
        'de': 'Die Subnetz-ID',
        'ru': 'идентификатор подсети',
        'pt': 'o ID da sub-rede',
        'nl': 'de subnet-ID',
        'fr': 'l\'identifiant du sous-réseau',
        'it': 'l\'ID della sottorete',
        'es': 'el ID de subred',
        'pl': 'identyfikator podsieci',
        'zh-cn': '子网ID'
    },
    'universe': {
        'en': 'The used DMX universe',
        'de': 'Das verwendete DMX-Universum',
        'ru': 'Используемая вселенная DMX',
        'pt': 'O universo DMX usado',
        'nl': 'Het gebruikte DMX-universum',
        'fr': 'L\'univers DMX utilisé',
        'it': 'L\'universo DMX usato',
        'es': 'El universo DMX usado',
        'pl': 'Używane uniwersum DMX',
        'zh-cn': '使用过的 DMX 宇宙'
    },
    'packetDelay': {
        'en': 'packet delay (in ms)',
        'de': 'Paketverzögerung (in ms)',
        'ru': 'задержка пакета (в мс)',
        'pt': 'atraso de pacote (em ms)',
        'nl': 'pakketvertraging (in ms)',
        'fr': 'délai de paquet (en ms)',
        'it': 'ritardo del pacchetto (in ms)',
        'es': 'retardo de paquete (en ms)',
        'pl': 'opóźnienie pakietu (w ms)',
        'zh-cn': '数据包延迟（以毫秒为单位）'
    },
    'packetDelay_tooltip': {
        'en': '40 ms corresponds to 25 ArtDMX packets per second. Number of packets = 1000 divided by packet delay',
        'de': '40 ms entsprechen 25 ArtDMX-Paketen pro Sekunde. Anzahl Pakete = 1000 geteilt durch Paketverzögerung',
        'ru': '40 мс соответствуют 25 пакетам ArtDMX в секунду. Количество пакетов = 1000, разделенное на задержку пакета',
        'pt': '40 ms correspondem a 25 pacotes ArtDMX por segundo. Número de pacotes = 1000 dividido pelo atraso do pacote',
        'nl': '40 ms komt overeen met 25 ArtDMX-pakketten per seconde. Aantal pakketten = 1000 gedeeld door pakketvertraging',
        'fr': '40 ms correspondent à 25 paquets ArtDMX par seconde. Nombre de paquets = 1000 divisé par le délai de paquet',
        'it': '40 ms corrispondono a 25 pacchetti ArtDMX al secondo. Numero di pacchetti = 1000 diviso per ritardo pacchetto packet',
        'es': '40 ms corresponde a 25 paquetes ArtDMX por segundo. Número de paquetes = 1000 dividido por el retraso del paquete',
        'pl': '40 ms odpowiada 25 pakietom ArtDMX na sekundę. Liczba pakietów = 1000 podzielone przez opóźnienie pakietu',
        'zh-cn': '40 毫秒对应于每秒 25 个 ArtDMX 数据包。数据包数 = 1000 除以数据包延迟'
    },
    'maxDmxAddress': {
        'en': 'maximum DMX address which will be sent and received',
        'de': 'maximale DMX-Adresse, die gesendet und empfangen wird',
        'ru': 'максимальный адрес DMX, который будет отправлен и получен',
        'pt': 'endereço DMX máximo que será enviado e recebido',
        'nl': 'maximale DMX-adres dat wordt verzonden en ontvangen',
        'fr': 'adresse DMX maximale qui sera envoyée et reçue',
        'it': 'indirizzo DMX massimo che verrà inviato e ricevuto',
        'es': 'dirección DMX máxima que se enviará y recibirá',
        'pl': 'maksymalny adres DMX, który zostanie wysłany i odebrany',
        'zh-cn': '将发送和接收的最大 DMX 地址'
    },
    'maxDmxAddress_tooltip': {
        'en': 'also for the merge mechnism. No address greater than this value will be whether recognised or sent nor processed',
        'de': 'auch für den Merge-Mechanismus. Es wird keine Adresse größer als dieser Wert erkannt oder gesendet oder verarbeitet',
        'ru': 'также для механизма слияния. Ни один адрес больше этого значения не будет ни распознан, ни отправлен, ни обработан.',
        'pt': 'também para o mecanismo de fusão. Nenhum endereço maior que este valor será reconhecido, enviado ou processado',
        'nl': 'ook voor het samenvoegmechanisme. Geen enkel adres groter dan deze waarde wordt herkend of verzonden of verwerkt',
        'fr': 'aussi pour le mécanisme de fusion. Aucune adresse supérieure à cette valeur ne sera reconnue ou envoyée ni traitée',
        'it': 'anche per il meccanismo di fusione. Nessun indirizzo maggiore di questo valore sarà riconosciuto o inviato o elaborato',
        'es': 'también para el mecanismo de fusión. Ninguna dirección superior a este valor será reconocida o enviada ni procesada',
        'pl': 'również dla mechanizmu łączenia. Żaden adres większy niż ta wartość nie zostanie rozpoznany, wysłany lub przetworzony',
        'zh-cn': '也适用于合并机制。大于此值的地址将不会被识别、发送或处理'
    }
};