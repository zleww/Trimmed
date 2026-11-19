-- Trimmed sales: sales with several items, payments, tips, stock, expenses,
-- and the end-of-day close.
--
-- Prices are always read from services and products here. The app sends only
-- what was sold and who did it, never an amount for an item.
-- Nothing is deleted. A mistake is voided with a reason and shows in the audit log.

create table public.sales (
  id                uuid primary key default gen_random_uuid(),
  appointment_id    uuid references public.appointments (id),
  recorded_by       uuid not null references public.staff (id),
  sold_at           timestamptz not null default now(),
  -- the Manila day of the sale, worked out by the database
  business_date     date generated always as (public.manila_date(sold_at)) stored,
  subtotal_centavos integer not null default 0 check (subtotal_centavos >= 0),
  discount_centavos integer not null default 0 check (discount_centavos >= 0),
  discount_reason   text,
  discount_by       uuid references public.staff (id),
  total_centavos    integer not null default 0 check (total_centavos >= 0),
  tips_centavos     integer not null default 0 check (tips_centavos >= 0),
  voided_at         timestamptz,
  voided_by         uuid references public.staff (id),
  void_reason       text,
  constraint sales_discount_needs_reason check (
    discount_centavos = 0 or (char_length(btrim(discount_reason)) >= 3 and discount_by is not null)
  ),
  constraint sales_void_complete check (
    (voided_at is null and voided_by is null and void_reason is null)
    or (voided_at is not null and voided_by is not null and char_length(btrim(void_reason)) >= 3)
  )
);

-- one live sale per appointment (a voided one can be redone)
create unique index sales_appointment_key on public.sales (appointment_id) where appointment_id is not null and voided_at is null;
create index sales_business_date_idx on public.sales (business_date);

create table public.sale_items (
  id                  uuid primary key default gen_random_uuid(),
  sale_id             uuid not null references public.sales (id),
  kind                text not null check (kind in ('service', 'product')),
  service_id          uuid references public.services (id),
  product_id          uuid references public.products (id),
  -- who did the service (required) or who sold the product (optional)
  barber_id           uuid references public.barbers (id),
  qty                 integer not null default 1 check (qty between 1 and 50),
  unit_price_centavos integer not null check (unit_price_centavos > 0),
  line_total_centavos integer not null check (line_total_centavos > 0),
  constraint sale_items_kind check (
    (kind = 'service' and service_id is not null and product_id is null and barber_id is not null and qty = 1)
    or (kind = 'product' and product_id is not null and service_id is null)
  ),
  constraint sale_items_total check (line_total_centavos = unit_price_centavos * qty)
);

create index sale_items_sale_idx on public.sale_items (sale_id);
create index sale_items_barber_idx on public.sale_items (barber_id);

-- recorded, not processed: the customer pays by GCash or Maya on their phone,
-- the desk types the reference number from the receipt
create table public.payments (
  id              uuid primary key default gen_random_uuid(),
  sale_id         uuid not null references public.sales (id),
  method          text not null check (method in ('cash', 'gcash', 'maya')),
  amount_centavos integer not null check (amount_centavos > 0),
  reference       text check (reference ~ '^[A-Z0-9]{6,30}$'),
  voided          boolean not null default false,
  -- e-wallet payments need the reference; cash must not have one
  constraint payments_reference check ((method = 'cash') = (reference is null))
);

-- the same e-wallet reference can't be used twice (unless that sale was voided)
create unique index payments_reference_key on public.payments (method, reference) where reference is not null and not voided;
create index payments_sale_idx on public.payments (sale_id);

-- tips are kept apart from the sale total, per barber
create table public.tips (
  id              uuid primary key default gen_random_uuid(),
  sale_id         uuid not null references public.sales (id),
  barber_id       uuid not null references public.barbers (id),
  amount_centavos integer not null check (amount_centavos > 0),
  voided          boolean not null default false
);

create index tips_barber_idx on public.tips (barber_id);

create table public.stock_movements (
  id         uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products (id),
  change     integer not null check (change <> 0),
  reason     text not null check (reason in ('stock_in', 'sale', 'void', 'adjust')),
  sale_id    uuid references public.sales (id),
  note       text,
  created_by uuid,
  created_at timestamptz not null default now()
);

create index stock_movements_product_idx on public.stock_movements (product_id, created_at);

create table public.expenses (
  id              uuid primary key default gen_random_uuid(),
  category        text not null check (char_length(btrim(category)) between 2 and 40),
  amount_centavos integer not null check (amount_centavos > 0),
  spent_on        date not null,
  note            text check (char_length(note) <= 200),
  recorded_by     uuid not null references public.staff (id),
  created_at      timestamptz not null default now(),
  voided_at       timestamptz,
  voided_by       uuid references public.staff (id),
  void_reason     text
);

-- Blind count: the desk types what is in the drawer and the wallets; only the
-- owner sees what was expected and the difference.
create table public.day_closes (
  id                     uuid primary key default gen_random_uuid(),
  close_date             date not null unique,
  expected_cash_centavos integer not null,
  expected_gcash_centavos integer not null,
  expected_maya_centavos integer not null,
  counted_cash_centavos  integer not null check (counted_cash_centavos >= 0),
  counted_gcash_centavos integer not null check (counted_gcash_centavos >= 0),
  counted_maya_centavos  integer not null check (counted_maya_centavos >= 0),
  closed_by              uuid not null references public.staff (id),
  note                   text check (char_length(note) <= 200),
  created_at             timestamptz not null default now()
);

create trigger audit_sales           after insert or update or delete on public.sales           for each row execute function public.audit_row();
create trigger audit_payments        after insert or update or delete on public.payments        for each row execute function public.audit_row();
create trigger audit_tips            after insert or update or delete on public.tips            for each row execute function public.audit_row();
create trigger audit_stock_movements after insert or update or delete on public.stock_movements for each row execute function public.audit_row();
create trigger audit_expenses        after insert or update or delete on public.expenses        for each row execute function public.audit_row();
create trigger audit_day_closes      after insert or update or delete on public.day_closes      for each row execute function public.audit_row();

-- ₱1,234.50 style, for error messages
create function public.peso(p_centavos bigint)
returns text
language sql
immutable
set search_path = ''
as $$
  select '₱' || to_char(p_centavos / 100.0, 'FM999,999,990.00')
$$;

-- ---------------------------------------------------------------------------
-- Record a sale
-- ---------------------------------------------------------------------------

-- p_items:    [{"service_id": "...", "barber_id": "..."}, {"product_id": "...", "qty": 2, "barber_id": null}]
-- p_payments: [{"method": "cash", "amount_centavos": 30000}, {"method": "gcash", "amount_centavos": 5000, "reference": "ABC123456"}]
-- p_tips:     [{"barber_id": "...", "amount_centavos": 5000}]
-- Payments must add up to the total plus tips. Discounts are owner only.
create function public.record_sale(
  p_appointment     uuid,
  p_items           jsonb,
  p_payments        jsonb,
  p_tips            jsonb default '[]',
  p_discount        integer default 0,
  p_discount_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sale     uuid;
  v_appt     public.appointments%rowtype;
  v_item     jsonb;
  v_pay      jsonb;
  v_tip      jsonb;
  v_price    integer;
  v_qty      integer;
  v_barber   uuid;
  v_stock    integer;
  v_method   text;
  v_amount   integer;
  v_ref      text;
  v_subtotal bigint := 0;
  v_tips     bigint := 0;
  v_paid     bigint := 0;
  v_discount integer := coalesce(p_discount, 0);
  v_total    bigint;
begin
  if not public.is_staff() then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  if exists (select 1 from public.day_closes d where d.close_date = public.manila_today()) then
    raise exception 'Today is already closed';
  end if;
  if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Add at least one service or product';
  end if;
  if jsonb_typeof(p_payments) is distinct from 'array' or jsonb_array_length(p_payments) = 0 then
    raise exception 'Add how the customer paid';
  end if;
  if p_tips is not null and jsonb_typeof(p_tips) <> 'array' then
    raise exception 'Tips are not in the right format';
  end if;

  if v_discount < 0 then
    raise exception 'A discount can''t be negative';
  end if;
  if v_discount > 0 then
    if not public.is_owner() then
      raise exception 'Only the owner can give a discount' using errcode = '42501';
    end if;
    if char_length(btrim(coalesce(p_discount_reason, ''))) < 3 then
      raise exception 'Give a reason for the discount';
    end if;
  end if;

  if p_appointment is not null then
    select * into v_appt from public.appointments a where a.id = p_appointment for update;
    if v_appt.id is null then
      raise exception 'Appointment not found';
    end if;
    if v_appt.status not in ('checked_in', 'in_chair', 'done') then
      raise exception 'Check the customer in before recording the sale';
    end if;
    if not public.is_front_desk() and v_appt.barber_id is distinct from public.my_barber_id() then
      raise exception 'Not allowed' using errcode = '42501';
    end if;
    if exists (select 1 from public.sales s where s.appointment_id = p_appointment and s.voided_at is null) then
      raise exception 'This appointment already has a sale';
    end if;
  end if;

  insert into public.sales (appointment_id, recorded_by, discount_centavos, discount_reason, discount_by)
  values (
    p_appointment, (select auth.uid()), v_discount,
    case when v_discount > 0 then btrim(p_discount_reason) end,
    case when v_discount > 0 then (select auth.uid()) end
  )
  returning id into v_sale;

  -- items: price always from the database
  for v_item in select * from jsonb_array_elements(p_items) loop
    v_barber := nullif(v_item ->> 'barber_id', '')::uuid;
    if v_barber is not null and not exists (select 1 from public.barbers b where b.id = v_barber and b.active) then
      raise exception 'That barber is not available';
    end if;

    if v_item ? 'service_id' then
      select s.price_centavos into v_price from public.services s
      where s.id = (v_item ->> 'service_id')::uuid and s.active;
      if v_price is null then
        raise exception 'A service in this sale is not available';
      end if;
      if v_barber is null then
        raise exception 'Pick the barber who did each service';
      end if;
      insert into public.sale_items (sale_id, kind, service_id, barber_id, qty, unit_price_centavos, line_total_centavos)
      values (v_sale, 'service', (v_item ->> 'service_id')::uuid, v_barber, 1, v_price, v_price);
      v_subtotal := v_subtotal + v_price;

    elsif v_item ? 'product_id' then
      v_qty := coalesce((v_item ->> 'qty')::integer, 1);
      if v_qty not between 1 and 50 then
        raise exception 'Quantity must be 1 to 50';
      end if;
      -- lock the product row so two sales can't sell the last one twice
      select p.price_centavos, p.stock_qty into v_price, v_stock from public.products p
      where p.id = (v_item ->> 'product_id')::uuid and p.active
      for update;
      if v_price is null then
        raise exception 'A product in this sale is not available';
      end if;
      if v_stock < v_qty then
        raise exception 'Not enough stock (only % left)', v_stock;
      end if;
      insert into public.sale_items (sale_id, kind, product_id, barber_id, qty, unit_price_centavos, line_total_centavos)
      values (v_sale, 'product', (v_item ->> 'product_id')::uuid, v_barber, v_qty, v_price, v_price * v_qty);
      update public.products set stock_qty = stock_qty - v_qty where id = (v_item ->> 'product_id')::uuid;
      insert into public.stock_movements (product_id, change, reason, sale_id, created_by)
      values ((v_item ->> 'product_id')::uuid, -v_qty, 'sale', v_sale, (select auth.uid()));
      v_subtotal := v_subtotal + v_price * v_qty;

    else
      raise exception 'Each item needs a service or a product';
    end if;
  end loop;

  if v_discount >= v_subtotal then
    raise exception 'The discount must be less than the total';
  end if;
  v_total := v_subtotal - v_discount;

  -- tips
  for v_tip in select * from jsonb_array_elements(coalesce(p_tips, '[]')) loop
    v_barber := (v_tip ->> 'barber_id')::uuid;
    v_amount := (v_tip ->> 'amount_centavos')::integer;
    if v_barber is null or not exists (select 1 from public.barbers b where b.id = v_barber and b.active) then
      raise exception 'Pick the barber for each tip';
    end if;
    if v_amount is null or v_amount <= 0 then
      raise exception 'A tip must be more than zero';
    end if;
    insert into public.tips (sale_id, barber_id, amount_centavos) values (v_sale, v_barber, v_amount);
    v_tips := v_tips + v_amount;
  end loop;

  -- payments
  for v_pay in select * from jsonb_array_elements(p_payments) loop
    v_method := v_pay ->> 'method';
    v_amount := (v_pay ->> 'amount_centavos')::integer;
    v_ref    := nullif(upper(regexp_replace(coalesce(v_pay ->> 'reference', ''), '\s', '', 'g')), '');
    if v_method is null or v_method not in ('cash', 'gcash', 'maya') then
      raise exception 'Payment must be cash, GCash or Maya';
    end if;
    if v_amount is null or v_amount <= 0 then
      raise exception 'A payment must be more than zero';
    end if;
    if v_method = 'cash' then
      v_ref := null;
    elsif v_ref is null or v_ref !~ '^[A-Z0-9]{6,30}$' then
      raise exception 'Enter the reference number from the receipt';
    end if;
    begin
      insert into public.payments (sale_id, method, amount_centavos, reference)
      values (v_sale, v_method, v_amount, v_ref);
    exception when unique_violation then
      raise exception 'That reference number was already used';
    end;
    v_paid := v_paid + v_amount;
  end loop;

  if v_paid <> v_total + v_tips then
    raise exception 'Payments must add up to % (total % plus tips %)',
      public.peso(v_total + v_tips), public.peso(v_total), public.peso(v_tips);
  end if;

  update public.sales
  set subtotal_centavos = v_subtotal, total_centavos = v_total, tips_centavos = v_tips
  where id = v_sale;

  -- the haircut is finished; free the rest of the barber's slot if they finished early
  if p_appointment is not null then
    update public.appointments
    set status = 'done',
        ends_at = case
          when starts_at < now() and now() < ends_at then now()
          else ends_at
        end
    where id = p_appointment;
  end if;

  return jsonb_build_object(
    'sale_id', v_sale,
    'subtotal_centavos', v_subtotal,
    'discount_centavos', v_discount,
    'total_centavos', v_total,
    'tips_centavos', v_tips
  );
end
$$;

-- Owner only. Payments, tips and stock are reversed; the appointment stays done.
create function public.void_sale(p_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sale public.sales%rowtype;
  v_item record;
begin
  if not public.is_owner() then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  if char_length(btrim(coalesce(p_reason, ''))) < 3 then
    raise exception 'Give a reason';
  end if;
  select * into v_sale from public.sales s where s.id = p_id for update;
  if v_sale.id is null then
    raise exception 'Sale not found';
  end if;
  if v_sale.voided_at is not null then
    raise exception 'This sale is already voided';
  end if;

  update public.sales set voided_at = now(), voided_by = (select auth.uid()), void_reason = btrim(p_reason)
  where id = p_id;
  update public.payments set voided = true where sale_id = p_id;
  update public.tips set voided = true where sale_id = p_id;

  for v_item in select i.product_id, i.qty from public.sale_items i where i.sale_id = p_id and i.kind = 'product' loop
    update public.products set stock_qty = stock_qty + v_item.qty where id = v_item.product_id;
    insert into public.stock_movements (product_id, change, reason, sale_id, created_by)
    values (v_item.product_id, v_item.qty, 'void', p_id, (select auth.uid()));
  end loop;
end
$$;

-- ---------------------------------------------------------------------------
-- Stock (owner)
-- ---------------------------------------------------------------------------

create function public.stock_in(p_product uuid, p_qty integer, p_note text default null)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_qty integer;
begin
  if not public.is_owner() then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  if p_qty is null or p_qty not between 1 and 1000 then
    raise exception 'Quantity must be 1 to 1000';
  end if;
  update public.products set stock_qty = stock_qty + p_qty where id = p_product returning stock_qty into v_qty;
  if v_qty is null then
    raise exception 'Product not found';
  end if;
  insert into public.stock_movements (product_id, change, reason, note, created_by)
  values (p_product, p_qty, 'stock_in', nullif(btrim(p_note), ''), (select auth.uid()));
  return v_qty;
end
$$;

-- after a physical count: set the real number, with a reason
create function public.adjust_stock(p_product uuid, p_counted integer, p_reason text)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now integer;
begin
  if not public.is_owner() then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  if p_counted is null or p_counted < 0 then
    raise exception 'Enter the number you counted';
  end if;
  if char_length(btrim(coalesce(p_reason, ''))) < 3 then
    raise exception 'Give a reason';
  end if;
  select p.stock_qty into v_now from public.products p where p.id = p_product for update;
  if v_now is null then
    raise exception 'Product not found';
  end if;
  if v_now <> p_counted then
    update public.products set stock_qty = p_counted where id = p_product;
    insert into public.stock_movements (product_id, change, reason, note, created_by)
    values (p_product, p_counted - v_now, 'adjust', btrim(p_reason), (select auth.uid()));
  end if;
  return p_counted;
end
$$;

-- ---------------------------------------------------------------------------
-- Expenses (owner)
-- ---------------------------------------------------------------------------

create function public.add_expense(p_category text, p_amount integer, p_spent_on date, p_note text default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if not public.is_owner() then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'Enter an amount';
  end if;
  if p_spent_on is null or p_spent_on > public.manila_today() then
    raise exception 'Pick a date that isn''t in the future';
  end if;
  insert into public.expenses (category, amount_centavos, spent_on, note, recorded_by)
  values (btrim(p_category), p_amount, p_spent_on, nullif(btrim(p_note), ''), (select auth.uid()))
  returning id into v_id;
  return v_id;
end
$$;

create function public.void_expense(p_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_owner() then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  if char_length(btrim(coalesce(p_reason, ''))) < 3 then
    raise exception 'Give a reason';
  end if;
  update public.expenses set voided_at = now(), voided_by = (select auth.uid()), void_reason = btrim(p_reason)
  where id = p_id and voided_at is null;
  if not found then
    raise exception 'Expense not found or already voided';
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- Close the day (blind count)
-- ---------------------------------------------------------------------------

create function public.close_day(p_cash integer, p_gcash integer, p_maya integer, p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_today date := public.manila_today();
  v_row   public.day_closes%rowtype;
begin
  if not public.is_front_desk() then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  if p_cash is null or p_gcash is null or p_maya is null or least(p_cash, p_gcash, p_maya) < 0 then
    raise exception 'Enter what you counted (0 if none)';
  end if;
  if exists (select 1 from public.day_closes d where d.close_date = v_today) then
    raise exception 'Today is already closed';
  end if;

  insert into public.day_closes (
    close_date, expected_cash_centavos, expected_gcash_centavos, expected_maya_centavos,
    counted_cash_centavos, counted_gcash_centavos, counted_maya_centavos, closed_by, note
  )
  select v_today,
         coalesce(sum(p.amount_centavos) filter (where p.method = 'cash'), 0),
         coalesce(sum(p.amount_centavos) filter (where p.method = 'gcash'), 0),
         coalesce(sum(p.amount_centavos) filter (where p.method = 'maya'), 0),
         p_cash, p_gcash, p_maya, (select auth.uid()), nullif(btrim(p_note), '')
  from public.payments p
  join public.sales s on s.id = p.sale_id
  where s.business_date = v_today and s.voided_at is null
  returning * into v_row;

  -- the desk only learns that it worked; the owner also sees the difference
  if public.is_owner() then
    return jsonb_build_object(
      'closed', true,
      'cash_difference_centavos', v_row.counted_cash_centavos - v_row.expected_cash_centavos,
      'gcash_difference_centavos', v_row.counted_gcash_centavos - v_row.expected_gcash_centavos,
      'maya_difference_centavos', v_row.counted_maya_centavos - v_row.expected_maya_centavos
    );
  end if;
  return jsonb_build_object('closed', true);
end
$$;

create function public.is_day_closed(p_date date)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_staff() and exists (select 1 from public.day_closes d where d.close_date = p_date)
$$;

-- ---------------------------------------------------------------------------
-- A barber's own numbers
-- ---------------------------------------------------------------------------

-- Only the caller's own chair. No shop totals, no other barbers.
create function public.my_earnings(p_from date, p_to date)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_barber uuid := public.my_barber_id();
begin
  if v_barber is null then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 92 then
    raise exception 'Pick a range of up to 3 months';
  end if;

  return jsonb_build_object(
    'services_count', (
      select count(*) from public.sale_items i join public.sales s on s.id = i.sale_id
      where i.barber_id = v_barber and i.kind = 'service' and s.voided_at is null
        and s.business_date between p_from and p_to),
    'services_centavos', (
      select coalesce(sum(i.line_total_centavos), 0) from public.sale_items i join public.sales s on s.id = i.sale_id
      where i.barber_id = v_barber and i.kind = 'service' and s.voided_at is null
        and s.business_date between p_from and p_to),
    'products_centavos', (
      select coalesce(sum(i.line_total_centavos), 0) from public.sale_items i join public.sales s on s.id = i.sale_id
      where i.barber_id = v_barber and i.kind = 'product' and s.voided_at is null
        and s.business_date between p_from and p_to),
    'tips_centavos', (
      select coalesce(sum(t.amount_centavos), 0) from public.tips t join public.sales s on s.id = t.sale_id
      where t.barber_id = v_barber and not t.voided
        and s.business_date between p_from and p_to)
  );
end
$$;

-- ---------------------------------------------------------------------------
-- Access rules
-- ---------------------------------------------------------------------------

revoke all on public.sales, public.sale_items, public.payments, public.tips,
              public.stock_movements, public.expenses, public.day_closes
from public, anon, authenticated;

alter table public.sales           enable row level security;
alter table public.sale_items      enable row level security;
alter table public.payments        enable row level security;
alter table public.tips            enable row level security;
alter table public.stock_movements enable row level security;
alter table public.expenses        enable row level security;
alter table public.day_closes      enable row level security;

revoke execute on function
  public.peso(bigint),
  public.record_sale(uuid, jsonb, jsonb, jsonb, integer, text),
  public.void_sale(uuid, text),
  public.stock_in(uuid, integer, text),
  public.adjust_stock(uuid, integer, text),
  public.add_expense(text, integer, date, text),
  public.void_expense(uuid, text),
  public.close_day(integer, integer, integer, text),
  public.is_day_closed(date),
  public.my_earnings(date, date)
from public, anon, authenticated;

-- read only; every write goes through the functions above
grant select on public.sales, public.sale_items, public.payments, public.tips,
                public.stock_movements, public.expenses, public.day_closes
to authenticated;

grant execute on function public.record_sale(uuid, jsonb, jsonb, jsonb, integer, text) to authenticated;
grant execute on function public.void_sale(uuid, text) to authenticated;
grant execute on function public.stock_in(uuid, integer, text) to authenticated;
grant execute on function public.adjust_stock(uuid, integer, text) to authenticated;
grant execute on function public.add_expense(text, integer, date, text) to authenticated;
grant execute on function public.void_expense(uuid, text) to authenticated;
grant execute on function public.close_day(integer, integer, integer, text) to authenticated;
grant execute on function public.is_day_closed(date) to authenticated;
grant execute on function public.my_earnings(date, date) to authenticated;

-- Owner sees everything. Other staff see only the sales they recorded today:
-- enough for a receipt, not enough to add up the shop's revenue for the month.
create policy sales_select on public.sales for select to authenticated
  using (
    (select public.is_owner())
    or ((select public.is_staff()) and recorded_by = (select auth.uid()) and business_date = (select public.manila_today()))
  );

-- these follow the sale: if you can see the sale, you can see its lines
create policy sale_items_select on public.sale_items for select to authenticated
  using (exists (select 1 from public.sales s where s.id = sale_id));
create policy payments_select on public.payments for select to authenticated
  using (exists (select 1 from public.sales s where s.id = sale_id));
create policy tips_select on public.tips for select to authenticated
  using (exists (select 1 from public.sales s where s.id = sale_id));

create policy stock_movements_select on public.stock_movements for select to authenticated
  using ((select public.is_owner()));
create policy expenses_select on public.expenses for select to authenticated
  using ((select public.is_owner()));
create policy day_closes_select on public.day_closes for select to authenticated
  using ((select public.is_owner()));
