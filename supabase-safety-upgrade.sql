-- ====================================================================
-- SUPABASE SAFETY UPGRADE & ZERO-DATA-LOSS SUITE (PHIÊN BẢN CHUẨN HOÁ)
-- Chạy script này trong: Supabase Dashboard > SQL Editor > New query > Run
-- Đảm bảo: 
-- 1. Idempotent: Bấm chạy nhiều lần vẫn thành công 100%, không báo lỗi tồn tại.
-- 2. Không làm mất bất kỳ dữ liệu lịch sử nào hiện có.
-- ====================================================================

-- BƯỚC 1: BỔ SUNG CÁC CỘT QUẢN LÝ KHÁCH THUÊ VÀO BẢNG ROOMS (NẾU CHƯA CÓ)
ALTER TABLE public.rooms ADD COLUMN IF NOT EXISTS status text DEFAULT 'rented';
ALTER TABLE public.rooms ADD COLUMN IF NOT EXISTS tenant_name text DEFAULT '';
ALTER TABLE public.rooms ADD COLUMN IF NOT EXISTS tenant_phone text DEFAULT '';
ALTER TABLE public.rooms ADD COLUMN IF NOT EXISTS start_date text DEFAULT '';
ALTER TABLE public.rooms ADD COLUMN IF NOT EXISTS deposit integer DEFAULT 0;

-- BƯỚC 2: KHÓA CHẶT RÀNG BUỘC KHOÁ NGOẠI (FOREIGN KEY) SANG 'ON DELETE RESTRICT'
-- Nguyên nhân mất dữ liệu lịch sử trước đây là do 'ON DELETE CASCADE' (xóa phòng sẽ tự xóa sạch hóa đơn).
-- 'RESTRICT' sẽ CẤM TUYỆT ĐỐI việc xóa phòng nếu phòng đó đã từng có dữ liệu lịch sử!
DO $$
DECLARE
    r RECORD;
BEGIN
    -- 2.1. Xóa tất cả Foreign Key cũ trên bảng records trỏ tới rooms
    FOR r IN (
        SELECT constraint_name 
        FROM information_schema.table_constraints 
        WHERE table_schema = 'public' 
          AND table_name = 'records' 
          AND constraint_type = 'FOREIGN KEY'
    ) LOOP
        EXECUTE 'ALTER TABLE public.records DROP CONSTRAINT ' || quote_ident(r.constraint_name);
    END LOOP;

    -- 2.2. Tạo lại Foreign Key an toàn với ON DELETE RESTRICT
    ALTER TABLE public.records 
    ADD CONSTRAINT fk_records_room_id 
    FOREIGN KEY (room_id) REFERENCES public.rooms(id) ON DELETE RESTRICT;
END $$;

-- BƯỚC 3: TẠO BẢNG KÉT SẮT DỰ PHÒNG TỰ ĐỘNG (RECORDS_VAULT)
-- Mọi thao tác UPDATE hoặc DELETE trên bảng records sẽ được tự động nhân bản 1 bản sao vào đây.
CREATE TABLE IF NOT EXISTS public.records_vault (
    vault_id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    action_type text NOT NULL, -- 'UPDATE' hoặc 'DELETE'
    record_id uuid,
    room_id uuid,
    start_date text,
    end_date text,
    elec_old integer,
    elec_new integer,
    water_old integer,
    water_new integer,
    archived_at timestamptz DEFAULT now()
);

-- Kích hoạt Row Level Security & tạo Policy an toàn (có DROP IF EXISTS để chạy lại không lỗi)
ALTER TABLE public.records_vault ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "public_records_vault" ON public.records_vault;
CREATE POLICY "public_records_vault" ON public.records_vault FOR ALL USING (true) WITH CHECK (true);

-- BƯỚC 4: DATABASE TRIGGER TỰ ĐỘNG SAO LƯU VÀO KÉT SẮT
CREATE OR REPLACE FUNCTION public.archive_record_to_vault()
RETURNS TRIGGER AS $$
BEGIN
    IF (TG_OP = 'DELETE') THEN
        INSERT INTO public.records_vault (action_type, record_id, room_id, start_date, end_date, elec_old, elec_new, water_old, water_new)
        VALUES ('DELETE', OLD.id, OLD.room_id, OLD.start_date, OLD.end_date, OLD.elec_old, OLD.elec_new, OLD.water_old, OLD.water_new);
        RETURN OLD;
    ELSIF (TG_OP = 'UPDATE') THEN
        INSERT INTO public.records_vault (action_type, record_id, room_id, start_date, end_date, elec_old, elec_new, water_old, water_new)
        VALUES ('UPDATE', OLD.id, OLD.room_id, OLD.start_date, OLD.end_date, OLD.elec_old, OLD.elec_new, OLD.water_old, OLD.water_new);
        RETURN NEW;
    END IF;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_records_vault ON public.records;
CREATE TRIGGER trg_records_vault
BEFORE UPDATE OR DELETE ON public.records
FOR EACH ROW EXECUTE FUNCTION public.archive_record_to_vault();

-- BƯỚC 5: KIỂM TRA & XÁC NHẬN KẾT QUẢ
SELECT 
    'BẢO VỆ DATABASE THÀNH CÔNG!' as status,
    (SELECT count(*) FROM public.rooms) as tong_so_phong,
    (SELECT count(*) FROM public.records) as tong_so_ban_ghi_lich_su;
