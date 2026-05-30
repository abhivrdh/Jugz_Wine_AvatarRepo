"""
Jugz Liquor and Wine — Flask Backend (Alex AI Sommelier)
Auth + Inventory + Store Info + Dynamic AI Chat
"""
from flask import Flask, render_template, request, jsonify, send_file, redirect, url_for
from flask_cors import CORS
from functools import wraps
import json, os, urllib.request, urllib.error, hashlib, secrets, time, uuid

app = Flask(__name__)
CORS(app)
app.secret_key = os.environ.get('APP_SECRET_KEY', 'dev-fallback-key-change-me')

KV_URL   = os.environ.get('KV_REST_API_URL', '')
KV_TOKEN = os.environ.get('KV_REST_API_TOKEN', '')

# ═══════════════════════════════════════
#  Redis Helper
# ═══════════════════════════════════════
def redis_cmd(*args):
    if not KV_URL or not KV_TOKEN: return None
    payload = json.dumps(list(args)).encode()
    req = urllib.request.Request(KV_URL, data=payload,
        headers={'Authorization': f'Bearer {KV_TOKEN}', 'Content-Type': 'application/json'}, method='POST')
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            return json.loads(resp.read().decode()).get('result')
    except Exception as e:
        print(f"Redis error: {e}")
        return None

# ═══════════════════════════════════════
#  Auth Helpers
# ═══════════════════════════════════════
def hash_password(pw):
    salt = secrets.token_hex(16)
    return f"{salt}:{hashlib.sha256((salt+pw).encode()).hexdigest()}"

def verify_password(pw, stored):
    if ':' not in stored: return False
    salt, h = stored.split(':', 1)
    return hashlib.sha256((salt+pw).encode()).hexdigest() == h

def has_users(): return redis_cmd('GET', 'jugz:has_users') == '1'

def get_user(u):
    d = redis_cmd('GET', f'jugz:user:{u}')
    return (json.loads(d) if isinstance(d, str) else d) if d else None

def create_user(u, pw, role='staff'):
    redis_cmd('SET', f'jugz:user:{u}', json.dumps({'username':u,'password':hash_password(pw),'role':role,'created':int(time.time())}))
    redis_cmd('SADD', 'jugz:users', u)
    redis_cmd('SET', 'jugz:has_users', '1')

def get_all_users():
    r = redis_cmd('SMEMBERS', 'jugz:users')
    return r if r else []

def delete_user(u):
    redis_cmd('DEL', f'jugz:user:{u}')
    redis_cmd('SREM', 'jugz:users', u)
    redis_cmd('DEL', f'jugz:active_session:{u}')
    if not redis_cmd('SMEMBERS', 'jugz:users'): redis_cmd('SET', 'jugz:has_users', '0')

def create_session(u):
    token = secrets.token_hex(32)
    old = redis_cmd('GET', f'jugz:active_session:{u}')
    if old: redis_cmd('DEL', f'jugz:session:{old}')
    redis_cmd('SET', f'jugz:session:{token}', json.dumps({'username':u,'created':int(time.time()),'token':token}), 'EX', '28800')
    redis_cmd('SET', f'jugz:active_session:{u}', token, 'EX', '28800')
    return token

def validate_session(token):
    if not token: return None
    d = redis_cmd('GET', f'jugz:session:{token}')
    if not d: return None
    s = json.loads(d) if isinstance(d, str) else d
    u = s.get('username')
    if redis_cmd('GET', f'jugz:active_session:{u}') != token:
        redis_cmd('DEL', f'jugz:session:{token}')
        return None
    return u

def destroy_session(token):
    d = redis_cmd('GET', f'jugz:session:{token}')
    if d:
        s = json.loads(d) if isinstance(d, str) else d
        redis_cmd('DEL', f'jugz:active_session:{s.get("username")}')
    redis_cmd('DEL', f'jugz:session:{token}')

def get_current_user():
    return validate_session(request.cookies.get('jugz_session'))

def require_auth(f):
    @wraps(f)
    def dec(*a, **kw):
        if not has_users(): return redirect(url_for('setup_page'))
        if not get_current_user(): return redirect(url_for('login_page'))
        return f(*a, **kw)
    return dec

def require_auth_api(f):
    @wraps(f)
    def dec(*a, **kw):
        if not get_current_user(): return jsonify({'error':'Session expired','kicked':True}), 401
        return f(*a, **kw)
    return dec

def require_admin(f):
    @wraps(f)
    def dec(*a, **kw):
        u = get_current_user()
        if not u: return redirect(url_for('login_page'))
        ud = get_user(u)
        if not ud or ud.get('role') != 'admin': return redirect(url_for('index'))
        return f(*a, **kw)
    return dec

def require_admin_api(f):
    @wraps(f)
    def dec(*a, **kw):
        u = get_current_user()
        if not u: return jsonify({'error':'Unauthorized'}), 401
        ud = get_user(u)
        if not ud or ud.get('role') != 'admin': return jsonify({'error':'Admin required'}), 403
        return f(*a, **kw)
    return dec

# ═══════════════════════════════════════
#  Inventory Helpers
# ═══════════════════════════════════════
CATEGORIES = ['Bourbon','Scotch','Tequila','Vodka','Gin','Rum','Wine','Beer','Cognac','Champagne','Rye','Mezcal','Brandy','Liqueur','Ready-to-Drink','Other']
SIZES = ['50ml','100ml','200ml','375ml','500ml','750ml','1L','1.75L','3L','Other']
TAG_OPTIONS = ['Premium','Value','Allocated','New Arrival','Staff Pick','Sale','Limited Edition','Local','Organic','Gift Set','Top Seller','Rare']
ICON_MAP = {'Bourbon':'🥃','Scotch':'🥃','Rye':'🥃','Tequila':'🌵','Mezcal':'🌵','Vodka':'🍸','Gin':'🌿','Rum':'🏝️','Wine':'🍷','Beer':'🍺','Cognac':'🥂','Brandy':'🥂','Champagne':'🍾','Liqueur':'🍹','Ready-to-Drink':'🥤','Other':'🍶'}

def get_inventory():
    """Get all products from Redis."""
    d = redis_cmd('GET', 'jugz:inventory')
    if d:
        return json.loads(d) if isinstance(d, str) else d
    return []

def save_inventory(products):
    """Save all products to Redis."""
    redis_cmd('SET', 'jugz:inventory', json.dumps(products))

def get_store_info():
    """Get store info from Redis."""
    d = redis_cmd('GET', 'jugz:store_info')
    if d:
        return json.loads(d) if isinstance(d, str) else d
    return {
        'name': 'Jugz Liquor and Wine',
        'address': 'Joplin, MO',
        'phone': '',
        'hours': {'mon':'9AM-9PM','tue':'9AM-9PM','wed':'9AM-9PM','thu':'9AM-9PM','fri':'9AM-10PM','sat':'9AM-10PM','sun':'12PM-6PM'},
        'policies': '',
        'events': [],
        'specials': []
    }

def save_store_info(info):
    redis_cmd('SET', 'jugz:store_info', json.dumps(info))

def build_system_prompt():
    """Build a dynamic system prompt with real store data."""
    inv = get_inventory()
    store = get_store_info()

    # Build inventory summary for AI
    in_stock = [p for p in inv if p.get('in_stock', True)]
    categories = {}
    for p in in_stock:
        cat = p.get('category', 'Other')
        if cat not in categories: categories[cat] = []
        categories[cat].append(p)

    inv_text = ""
    for cat, prods in sorted(categories.items()):
        items = []
        for p in prods:
            item = p['name']
            if p.get('brand'): item += f" by {p['brand']}"
            if p.get('price'): item += f" — ${p['price']}"
            if p.get('size'): item += f" ({p['size']})"
            if p.get('abv'): item += f" {p['abv']}% ABV"
            if p.get('description'): item += f". {p['description']}"
            if p.get('aisle'): item += f" [Aisle: {p['aisle']}]"
            tags = p.get('tags', [])
            if tags: item += f" [{', '.join(tags)}]"
            items.append(item)
        inv_text += f"\n{cat}: " + " | ".join(items)

    # Build specials text
    specials_text = ""
    if store.get('specials'):
        active = [s for s in store['specials'] if not s.get('expires') or s['expires'] >= time.strftime('%Y-%m-%d')]
        if active:
            specials_text = "\n\nCURRENT SPECIALS & DEALS:\n" + "\n".join([f"- {s['title']}: {s['description']}" for s in active])

    # Build events text
    events_text = ""
    if store.get('events'):
        events_text = "\n\nUPCOMING EVENTS:\n" + "\n".join([f"- {e['title']} ({e.get('date','')}): {e.get('description','')}" for e in store['events']])

    # Build hours text
    hours_text = ""
    if store.get('hours'):
        h = store['hours']
        hours_text = f"\n\nSTORE HOURS: Mon {h.get('mon','')}, Tue {h.get('tue','')}, Wed {h.get('wed','')}, Thu {h.get('thu','')}, Fri {h.get('fri','')}, Sat {h.get('sat','')}, Sun {h.get('sun','')}"

    policies_text = f"\n\nSTORE POLICIES: {store.get('policies','')}" if store.get('policies') else ""

    system = f"""You are Alex, a warm and passionate AI liquor expert at {store.get('name', 'Jugz Liquor and Wine')} in {store.get('address', 'Joplin, MO')}.{f" Phone: {store['phone']}" if store.get('phone') else ""}

Personality: Enthusiastic, knowledgeable, friendly bartender tone. Use phrases like "Oh great choice!", "I love this one!", "Pro tip:", "Fun fact:", "Between you and me…"

Rules:
- Keep responses VERY SHORT — 1-2 sentences MAX. Be direct and concise.
- ONLY recommend products that are in our actual store inventory below. Do NOT make up products we don't carry.
- If asked about a product we don't carry, say we don't have it and suggest one similar thing we do carry.
- Include prices when recommending products.
- If a product has an aisle location, mention it so the customer can find it easily.
- Mention if something is on sale or is a staff pick.
- Responses will be spoken aloud — no bullet points, no markdown, no symbols, no long lists.
- Do NOT list multiple products unless specifically asked. Recommend ONE product at a time.
- Be genuinely excited but brief — like a quick bartender recommendation, not a lecture.
- If asked about store hours, policies, events or specials, give just the answer.

OUR CURRENT INVENTORY:{inv_text if inv_text else " (No products added yet — tell the customer to check back soon!)"}
{specials_text}{events_text}{hours_text}{policies_text}"""

    return system

# ═══════════════════════════════════════
#  Fallback hardcoded data (used if no inventory in Redis)
# ═══════════════════════════════════════
FALLBACK_PRODUCTS = [
    {"id":1,"name":"Blanton's Single Barrel","category":"Bourbon","desc":"The original single barrel bourbon. Vanilla, caramel, dried fruit.","tags":["Bourbon","Premium","Allocated"],"icon":"🥃"},
    {"id":2,"name":"Buffalo Trace","category":"Bourbon","desc":"Best everyday bourbon. Vanilla, caramel, mint, oak.","tags":["Bourbon","Value"],"icon":"🥃"},
    {"id":3,"name":"Woodford Reserve","category":"Bourbon","desc":"Triple distilled. Dried fruit, vanilla, chocolate.","tags":["Bourbon","Premium"],"icon":"🥃"},
    {"id":4,"name":"Don Julio 1942","category":"Tequila","desc":"Aged 2.5 years. Silky caramel, vanilla, dark chocolate.","tags":["Tequila","Añejo","Premium"],"icon":"🌵"},
    {"id":5,"name":"Hendrick's Gin","category":"Gin","desc":"Bulgarian rose and cucumber infusion. Unique, refreshing.","tags":["Gin","Floral"],"icon":"🌿"},
    {"id":6,"name":"Tito's Handmade Vodka","category":"Vodka","desc":"Texas corn, gluten-free, incredibly smooth.","tags":["Vodka","Value"],"icon":"🍸"},
]
RECIPES = [
    {"name":"Old Fashioned","difficulty":"Easy","ingredients":["2oz Bourbon","1 Sugar cube","2 dashes Angostura bitters","Orange peel"],"steps":["Muddle sugar and bitters in glass","Add large ice cube","Pour bourbon over ice","Stir 30 seconds","Express orange peel over glass"]},
    {"name":"Classic Margarita","difficulty":"Easy","ingredients":["2oz Blanco tequila","1oz Fresh lime juice","¾oz Cointreau","Salt rim"],"steps":["Salt rim of coupe glass","Combine tequila, lime, Cointreau in shaker","Shake hard with ice","Strain into glass","Garnish with lime wheel"]},
    {"name":"Negroni","difficulty":"Easy","ingredients":["1oz Gin","1oz Campari","1oz Sweet vermouth","Orange peel"],"steps":["Combine all in mixing glass with ice","Stir 20 seconds","Strain into rocks glass over ice","Express orange peel over glass"]},
    {"name":"Whiskey Sour","difficulty":"Medium","ingredients":["2oz Bourbon","¾oz Lemon juice","¾oz Simple syrup","1 Egg white"],"steps":["Dry shake all ingredients vigorously","Add ice and shake again hard","Double strain into chilled coupe","Optional Angostura float on top"]},
    {"name":"Espresso Martini","difficulty":"Medium","ingredients":["2oz Vodka","1oz Kahlúa","1oz Hot espresso","3 Coffee beans"],"steps":["Combine vodka, Kahlúa and espresso in shaker","Shake very hard with ice","Strain into chilled martini glass","Garnish with 3 coffee beans"]},
    {"name":"Aperol Spritz","difficulty":"Easy","ingredients":["3oz Prosecco","2oz Aperol","1oz Soda water","Orange slice"],"steps":["Fill wine glass with ice","Add Aperol then Prosecco","Top with soda water gently","Garnish with orange slice"]},
    {"name":"Paper Plane","difficulty":"Medium","ingredients":["¾oz Bourbon","¾oz Aperol","¾oz Amaro Nonino","¾oz Lemon juice"],"steps":["Combine equal parts in shaker with ice","Shake hard","Strain into chilled coupe","No garnish needed"]},
    {"name":"Penicillin","difficulty":"Advanced","ingredients":["2oz Blended Scotch","¾oz Lemon juice","¾oz Honey-ginger syrup","¼oz Islay Scotch (float)"],"steps":["Shake blended Scotch, lemon, honey-ginger syrup with ice","Strain into rocks glass over large ice","Float Islay Scotch on top gently","Garnish with candied ginger"]},
]

# ═══════════════════════════════════════
#  Auth Pages
# ═══════════════════════════════════════
@app.route('/setup')
def setup_page():
    if has_users():
        if get_current_user(): return redirect(url_for('index'))
        return redirect(url_for('login_page'))
    return render_template('setup.html')

@app.route('/api/setup', methods=['POST'])
def setup_action():
    if has_users(): return jsonify({'error': 'Setup already completed'}), 403
    data = request.get_json()
    u = data.get('username', '').strip().lower()
    pw = data.get('password', '')
    if not u or not pw: return jsonify({'error': 'Username and password required'}), 400
    if len(u) < 3: return jsonify({'error': 'Username must be at least 3 characters'}), 400
    if len(pw) < 6: return jsonify({'error': 'Password must be at least 6 characters'}), 400
    create_user(u, pw, role='admin')
    # Verify user was actually saved
    check = get_user(u)
    if not check:
        return jsonify({'error': 'Failed to save to database. Check Redis connection.'}), 500
    token = create_session(u)
    resp = jsonify({'success': True, 'redirect': '/'})
    is_secure = request.headers.get('X-Forwarded-Proto') == 'https'
    resp.set_cookie('jugz_session', token, httponly=True, secure=is_secure, samesite='Lax', max_age=28800)
    return resp

@app.route('/api/debug/redis')
def debug_redis():
    """Check Redis connectivity — visit /api/debug/redis to diagnose issues."""
    try:
        redis_cmd('SET', 'jugz:test', 'ok')
        val = redis_cmd('GET', 'jugz:test')
        hu = redis_cmd('GET', 'jugz:has_users')
        users = redis_cmd('SMEMBERS', 'jugz:users')
        return jsonify({'redis_ok': val == 'ok', 'has_users': hu, 'users': users, 'kv_url_set': bool(KV_URL), 'kv_token_set': bool(KV_TOKEN)})
    except Exception as e:
        return jsonify({'error': str(e), 'kv_url_set': bool(KV_URL), 'kv_token_set': bool(KV_TOKEN)}), 500

@app.route('/login')
def login_page():
    if not has_users(): return redirect(url_for('setup_page'))
    if get_current_user(): return redirect(url_for('index'))
    return render_template('login.html')

@app.route('/api/login', methods=['POST'])
def login_action():
    data = request.get_json()
    u = data.get('username', '').strip().lower()
    pw = data.get('password', '')
    ud = get_user(u)
    if not ud or not verify_password(pw, ud.get('password', '')):
        return jsonify({'error': 'Invalid username or password'}), 401
    token = create_session(u)
    resp = jsonify({'success': True, 'redirect': '/'})
    is_secure = request.headers.get('X-Forwarded-Proto') == 'https'
    resp.set_cookie('jugz_session', token, httponly=True, secure=is_secure, samesite='Lax', max_age=28800)
    return resp

@app.route('/logout')
def logout():
    token = request.cookies.get('jugz_session')
    if token: destroy_session(token)
    resp = redirect(url_for('login_page'))
    resp.delete_cookie('jugz_session')
    return resp

@app.route('/api/session-check')
def session_check():
    u = get_current_user()
    if u: return jsonify({'valid': True, 'username': u})
    return jsonify({'valid': False}), 401

# ═══════════════════════════════════════
#  Admin: Users
# ═══════════════════════════════════════
@app.route('/admin')
@require_admin
def admin_page(): return render_template('admin.html')

@app.route('/api/admin/users')
@require_admin_api
def admin_list_users():
    users = []
    for u in get_all_users():
        d = get_user(u)
        if d: users.append({'username':d.get('username',u),'role':d.get('role','staff'),'created':d.get('created',0)})
    return jsonify(users)

@app.route('/api/admin/users', methods=['POST'])
@require_admin_api
def admin_add_user():
    data = request.get_json()
    u = data.get('username','').strip().lower()
    pw = data.get('password','')
    role = data.get('role','staff')
    if not u or not pw: return jsonify({'error':'Required'}), 400
    if len(u) < 3: return jsonify({'error':'Username min 3 chars'}), 400
    if len(pw) < 6: return jsonify({'error':'Password min 6 chars'}), 400
    if get_user(u): return jsonify({'error':'Username exists'}), 409
    if role not in ('admin','staff'): role = 'staff'
    create_user(u, pw, role)
    return jsonify({'success': True})

@app.route('/api/admin/users/<username>', methods=['DELETE'])
@require_admin_api
def admin_delete_user(username):
    if username == get_current_user(): return jsonify({'error':'Cannot delete yourself'}), 400
    if not get_user(username): return jsonify({'error':'Not found'}), 404
    delete_user(username)
    return jsonify({'success': True})

# ═══════════════════════════════════════
#  Admin: Inventory
# ═══════════════════════════════════════
@app.route('/admin/inventory')
@require_admin
def inventory_page(): return render_template('inventory.html')

@app.route('/api/admin/inventory')
@require_admin_api
def api_get_inventory():
    return jsonify({'products': get_inventory(), 'categories': CATEGORIES, 'sizes': SIZES, 'tags': TAG_OPTIONS})

@app.route('/api/admin/inventory', methods=['POST'])
@require_admin_api
def api_add_product():
    data = request.get_json()
    inv = get_inventory()
    product = {
        'id': str(uuid.uuid4())[:8],
        'name': data.get('name','').strip(),
        'brand': data.get('brand','').strip(),
        'category': data.get('category','Other'),
        'price': data.get('price', 0),
        'sale_price': data.get('sale_price', None),
        'size': data.get('size','750ml'),
        'abv': data.get('abv', ''),
        'description': data.get('description','').strip(),
        'tags': data.get('tags', []),
        'in_stock': data.get('in_stock', True),
        'aisle': data.get('aisle', '').strip(),
        'image_url': data.get('image_url', '').strip(),
        'icon': ICON_MAP.get(data.get('category','Other'), '🍶'),
        'created': int(time.time())
    }
    if not product['name']: return jsonify({'error':'Product name required'}), 400
    inv.append(product)
    save_inventory(inv)
    return jsonify({'success': True, 'product': product})

@app.route('/api/admin/inventory/<pid>', methods=['PUT'])
@require_admin_api
def api_update_product(pid):
    data = request.get_json()
    inv = get_inventory()
    for i, p in enumerate(inv):
        if p['id'] == pid:
            inv[i].update({
                'name': data.get('name', p['name']).strip(),
                'brand': data.get('brand', p.get('brand','')).strip(),
                'category': data.get('category', p['category']),
                'price': data.get('price', p.get('price', 0)),
                'sale_price': data.get('sale_price', p.get('sale_price')),
                'size': data.get('size', p.get('size','750ml')),
                'abv': data.get('abv', p.get('abv','')),
                'description': data.get('description', p.get('description','')).strip(),
                'tags': data.get('tags', p.get('tags',[])),
                'in_stock': data.get('in_stock', p.get('in_stock', True)),
                'aisle': data.get('aisle', p.get('aisle','')).strip(),
                'image_url': data.get('image_url', p.get('image_url','')).strip(),
                'icon': ICON_MAP.get(data.get('category', p['category']), '🍶'),
            })
            save_inventory(inv)
            return jsonify({'success': True})
    return jsonify({'error':'Product not found'}), 404

@app.route('/api/admin/inventory/<pid>', methods=['DELETE'])
@require_admin_api
def api_delete_product(pid):
    inv = get_inventory()
    inv = [p for p in inv if p['id'] != pid]
    save_inventory(inv)
    return jsonify({'success': True})

# ═══════════════════════════════════════
#  Admin: Store Info
# ═══════════════════════════════════════
@app.route('/admin/store')
@require_admin
def store_page(): return render_template('store.html')

@app.route('/api/admin/store')
@require_admin_api
def api_get_store():
    return jsonify(get_store_info())

@app.route('/api/admin/store', methods=['PUT'])
@require_admin_api
def api_update_store():
    data = request.get_json()
    info = get_store_info()
    info.update({
        'name': data.get('name', info.get('name','')),
        'address': data.get('address', info.get('address','')),
        'phone': data.get('phone', info.get('phone','')),
        'hours': data.get('hours', info.get('hours',{})),
        'policies': data.get('policies', info.get('policies','')),
    })
    save_store_info(info)
    return jsonify({'success': True})

@app.route('/api/admin/store/specials', methods=['POST'])
@require_admin_api
def api_add_special():
    data = request.get_json()
    info = get_store_info()
    if 'specials' not in info: info['specials'] = []
    info['specials'].append({
        'id': str(uuid.uuid4())[:8],
        'title': data.get('title','').strip(),
        'description': data.get('description','').strip(),
        'expires': data.get('expires',''),
    })
    save_store_info(info)
    return jsonify({'success': True})

@app.route('/api/admin/store/specials/<sid>', methods=['DELETE'])
@require_admin_api
def api_delete_special(sid):
    info = get_store_info()
    info['specials'] = [s for s in info.get('specials',[]) if s.get('id') != sid]
    save_store_info(info)
    return jsonify({'success': True})

@app.route('/api/admin/store/events', methods=['POST'])
@require_admin_api
def api_add_event():
    data = request.get_json()
    info = get_store_info()
    if 'events' not in info: info['events'] = []
    info['events'].append({
        'id': str(uuid.uuid4())[:8],
        'title': data.get('title','').strip(),
        'date': data.get('date',''),
        'description': data.get('description','').strip(),
    })
    save_store_info(info)
    return jsonify({'success': True})

@app.route('/api/admin/store/events/<eid>', methods=['DELETE'])
@require_admin_api
def api_delete_event(eid):
    info = get_store_info()
    info['events'] = [e for e in info.get('events',[]) if e.get('id') != eid]
    save_store_info(info)
    return jsonify({'success': True})

# ═══════════════════════════════════════
#  App Routes (Protected)
# ═══════════════════════════════════════
@app.route('/api/store/promos')
@require_auth_api
def api_store_promos():
    info = get_store_info()
    specials = [s for s in info.get('specials', []) if not s.get('expires') or s['expires'] >= time.strftime('%Y-%m-%d')]
    return jsonify({'specials': specials, 'events': info.get('events', [])})

@app.route('/')
@require_auth
def index():
    u = get_current_user()
    ud = get_user(u) if u else {}
    return render_template('index.html', current_user=u, user_role=ud.get('role','staff') if ud else 'staff')

@app.route('/api/products')
@require_auth_api
def get_products_api():
    inv = get_inventory()
    if not inv: inv = FALLBACK_PRODUCTS
    category = request.args.get('category','').lower()
    query = request.args.get('q','').lower()
    results = inv
    if category: results = [p for p in results if p.get('category','').lower() == category]
    if query: results = [p for p in results if query in p.get('name','').lower() or query in p.get('description', p.get('desc','')).lower() or any(query in t.lower() for t in p.get('tags',[]))]
    # Normalize for frontend
    out = []
    for p in results:
        out.append({
            'id': p.get('id', 0),
            'name': p.get('name',''),
            'category': p.get('category',''),
            'desc': p.get('description', p.get('desc','')),
            'tags': p.get('tags',[]),
            'icon': p.get('icon', ICON_MAP.get(p.get('category',''), '🍶')),
            'price': p.get('price'),
            'sale_price': p.get('sale_price'),
            'brand': p.get('brand',''),
            'size': p.get('size',''),
            'abv': p.get('abv',''),
            'in_stock': p.get('in_stock', True),
            'aisle': p.get('aisle', ''),
            'image_url': p.get('image_url', ''),
        })
    return jsonify(out)

@app.route('/api/recipes')
@require_auth_api
def get_recipes_api(): return jsonify(RECIPES)

@app.route('/api/chat', methods=['POST'])
@require_auth_api
def chat():
    data = request.get_json()
    messages = data.get('messages', [])
    # Always use dynamic system prompt with real store data
    system = build_system_prompt()
    api_key = os.environ.get('ANTHROPIC_API_KEY', '')
    payload = json.dumps({"model": "claude-sonnet-4-20250514", "max_tokens": 150, "system": system, "messages": messages}).encode()
    req = urllib.request.Request('https://api.anthropic.com/v1/messages', data=payload,
        headers={'Content-Type':'application/json','anthropic-version':'2023-06-01','x-api-key':api_key,'anthropic-dangerous-direct-browser-access':'true'}, method='POST')
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            result = json.loads(resp.read().decode())
            return jsonify({'reply': result['content'][0]['text']})
    except urllib.error.HTTPError as e: return jsonify({'error': e.read().decode()}), e.code
    except Exception as e: return jsonify({'error': str(e)}), 500

@app.route('/api/search')
@require_auth_api
def search():
    q = request.args.get('q','').lower()
    if not q: return jsonify([])
    inv = get_inventory()
    if not inv: inv = FALLBACK_PRODUCTS
    results = [p for p in inv if q in p.get('name','').lower() or q in p.get('description',p.get('desc','')).lower() or any(q in t.lower() for t in p.get('tags',[]))]
    return jsonify(results[:8])

# ═══════════════════════════════════════
#  Static Assets
# ═══════════════════════════════════════
@app.route('/static/assets/avatar.glb')
def serve_glb(): return send_file(os.path.join(os.path.dirname(__file__),'static','assets','avatar.glb'), mimetype='model/gltf-binary', conditional=True, etag=True, max_age=0)

@app.route('/static/js/vendor/three.min.js')
def serve_three(): return send_file(os.path.join(os.path.dirname(__file__),'static','js','vendor','three.min.js'), mimetype='application/javascript', max_age=86400)

@app.route('/static/js/vendor/GLTFLoader.js')
def serve_gltf(): return send_file(os.path.join(os.path.dirname(__file__),'static','js','vendor','GLTFLoader.js'), mimetype='application/javascript', max_age=86400)

@app.route('/static/assets/logo.jpeg')
def serve_logo(): return send_file(os.path.join(os.path.dirname(__file__),'static','assets','logo.jpeg'), mimetype='image/jpeg', max_age=86400)

@app.route('/static/assets/bg/<path:filename>')
def serve_bg(filename):
    p = os.path.join(os.path.dirname(__file__),'static','assets','bg',filename)
    if not os.path.exists(p): return '', 404
    mime = 'image/jpeg' if filename.lower().endswith(('.jpg','.jpeg')) else 'image/png'
    return send_file(p, mimetype=mime, max_age=86400)

if __name__ == '__main__':
    print("\n🍾 Jugz Liquor and Wine — Alex AI Sommelier")
    print("   http://localhost:5000\n")
    app.run(debug=True, port=5000, host='0.0.0.0')
