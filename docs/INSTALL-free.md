# Lyrichord Free · วิธีติดตั้ง (English below)

**Lyrichord Free** แกะคอร์ด คีย์ ทำนอง และเนื้อร้องจากไฟล์เพลง แล้วเล่นตาม ซ้อม ขึ้นเวที และส่งออกได้
ทำงานในคอมพิวเตอร์ของคุณ ไม่ต้องต่ออินเทอร์เน็ต แจกฟรีและเปิดซอร์สโค้ด (MIT)

## ก่อนติดตั้ง

| | Mac | Windows |
|---|---|---|
| ระบบ | Apple Silicon (M1 ขึ้นไป), macOS 12 ขึ้นไป | Windows 10 / 11 แบบ 64 บิต |
| หน่วยความจำ | แนะนำ 16 GB (8 GB ใช้ได้แต่ช้ากว่า) | แนะนำ 16 GB (8 GB ใช้ได้แต่ช้ากว่า) |
| พื้นที่ว่าง | ประมาณ 3 GB | ประมาณ 3 GB |
| ไฟล์ที่ดาวน์โหลด | `LyrichordFree-<เวอร์ชัน>-mac-arm64.dmg` | `LyrichordFree-Setup-<เวอร์ชัน>.exe` |

## ปลอดภัยไหม: ทำไมเครื่องถึงเตือน

Lyrichord Free เป็นโครงการแจกฟรี จึงยังไม่ได้ซื้อใบรับรองนักพัฒนาจาก Apple / Microsoft (มีค่าใช้จ่ายรายปี)
ระบบจึงแสดงคำเตือนว่า "ไม่รู้จักผู้พัฒนา" ซึ่ง **ไม่ได้แปลว่ามีไวรัส** แต่แปลว่าไม่มีใบรับรองแบบเสียเงิน

ปลอดภัยเมื่อ:
1. **ดาวน์โหลดจากหน้า Releases ของโครงการบน GitHub เท่านั้น** (ลิงก์ที่ผู้พัฒนาให้ไว้) อย่าดาวน์โหลดจากเว็บอื่นหรือไฟล์ที่ส่งต่อกันมา
2. ซอร์สโค้ดเปิดให้ทุกคนตรวจได้ และตัวติดตั้งสร้างอัตโนมัติจากซอร์สโค้ดบน GitHub
3. (ถ้าต้องการตรวจเพิ่ม) เทียบรหัส SHA-256 ของไฟล์กับที่แสดงในหน้า Release
   - Mac: เปิด Terminal พิมพ์ `shasum -a 256 ` แล้วลากไฟล์มาวาง กด Enter
   - Windows: เปิด PowerShell พิมพ์ `Get-FileHash ` แล้วลากไฟล์มาวาง กด Enter

## ติดตั้งบน Mac
1. ดับเบิลคลิกไฟล์ `.dmg` แล้วลาก **Lyrichord Free** ไปไว้ในโฟลเดอร์ **Applications**
2. เปิด Lyrichord Free จาก Applications ครั้งแรกจะขึ้นคำเตือน ให้กด **Done** (หรือ ยกเลิก)
3. ไปที่ **System Settings › Privacy & Security** เลื่อนลงจะเห็น "Lyrichord Free was blocked" กด **Open Anyway** แล้วยืนยันด้วยรหัสผ่านเครื่อง
4. ครั้งต่อไปเปิดได้ตามปกติ

## ติดตั้งบน Windows
1. ดับเบิลคลิก `LyrichordFree-Setup-<เวอร์ชัน>.exe`
2. ถ้าขึ้นหน้าจอสีน้ำเงิน "Windows protected your PC" ให้กด **More info** แล้วกด **Run anyway**
3. กด Next จนเสร็จ (ไม่ต้องใช้สิทธิ์ผู้ดูแลระบบ)

## เริ่มใช้งาน
- เปิดแอปแล้วจะมีหน้าต่างเล็กขึ้น และหน้าแอปเปิดในเว็บเบราว์เซอร์เอง
- ครั้งแรกจะมีข้อตกลงสั้นๆ 3 ข้อ และคำแนะนำ 5 ขั้น
- กด **+ เพิ่มเพลง** แล้วเลือกไฟล์เพลง (mp3, m4a, wav)

## ความเป็นส่วนตัวและลิขสิทธิ์
- เพลงและทุกอย่างที่คุณแก้ อยู่ในเครื่องของคุณเท่านั้น แอปไม่มีบัญชีผู้ใช้ ไม่เก็บสถิติ ไม่มีโฆษณา
- ใช้กับเพลงที่คุณมีสิทธิ์ใช้ อย่าเผยแพร่หรือขายคอร์ดและเนื้อร้องของเพลงที่มีลิขสิทธิ์ การใช้ในพิธีนมัสการหรือฉายบนจอ ควรมีใบอนุญาตที่เหมาะสม เช่น CCLI

## ถอนการติดตั้ง
- Mac: ลาก Lyrichord Free จาก Applications ไปถังขยะ (เพลงของคุณอยู่ที่ `~/Library/Application Support/Lyrichord Free` ลบได้ถ้าไม่ใช้แล้ว)
- Windows: Settings › Apps › Lyrichord Free › Uninstall (เพลงอยู่ที่ `%LOCALAPPDATA%\Lyrichord Free`)

---

# Lyrichord Free · How to install

**Lyrichord Free** works out the chords, key, melody and lyrics of a song file, then lets you play along, practise, perform and export.
It runs on your own computer, needs no internet, and is free and open source (MIT).

## Before you install
- Mac: Apple Silicon (M1 or newer), macOS 12+. Windows: Windows 10 / 11, 64-bit.
- 16 GB of memory recommended (8 GB works, more slowly); about 3 GB of free disk space.

## Is it safe? Why your computer warns you
Lyrichord Free is a free project and does not (yet) have a paid Apple / Microsoft developer certificate, so the system says
the developer is unidentified. **That does not mean it contains a virus**; it means there is no paid certificate. It is safe when:
1. you download it **only from the project's GitHub Releases page** (the link the developer gives), never from another site or a forwarded file;
2. the source code is open for anyone to check, and the installers are built automatically from it on GitHub;
3. (optional) the file's SHA-256 matches the one on the Release page: `shasum -a 256 <file>` (Mac) or `Get-FileHash <file>` (Windows PowerShell).

## Mac
1. Open the `.dmg` and drag **Lyrichord Free** to **Applications**.
2. Open it once; when macOS warns you, click **Done**.
3. Go to **System Settings › Privacy & Security**, find "Lyrichord Free was blocked", click **Open Anyway** and confirm.

## Windows
1. Run `LyrichordFree-Setup-<version>.exe`.
2. If "Windows protected your PC" appears, click **More info › Run anyway**.
3. Click Next to the end (no administrator rights needed).

## Privacy and copyright
Your songs and edits stay on your computer: no accounts, no tracking, no ads. Use songs you have the right to use; don't publish or sell
copyrighted chords and lyrics. For worship services or projection, have the right licence (e.g. CCLI).
