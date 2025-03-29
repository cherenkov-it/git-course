const express = require('express');
const mongoose = require('mongoose');
const path = require('path');
const multer = require('multer');

const app = express();

// Подключаемся к базе данных mysearch
mongoose.connect('mongodb://127.0.0.1:27017/mysearch', {
  useNewUrlParser: true,
  useUnifiedTopology: true
})
  .then(() => console.log('MongoDB connected'))
  .catch(err => console.error('MongoDB connection error:', err));

// Настраиваем парсеры для формы и JSON
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// Настраиваем шаблонизатор EJS
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Подключаем статические файлы (CSS, картинки и т.д.)
app.use(express.static(path.join(__dirname, 'public')));

// Раздаём статические файлы из папки uploads
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Настройка Multer для загрузки изображений
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, 'uploads/');
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const ext = path.extname(file.originalname);
    cb(null, file.fieldname + '-' + uniqueSuffix + ext);
  }
});
const upload = multer({ storage: storage });

// Создаём схему и модель для продукта
const itemSchema = new mongoose.Schema({
  title: String,
  description: String,
  image: { type: String, default: '' }
});
itemSchema.index({ title: 'text', description: 'text' });
const Item = mongoose.model('Item', itemSchema);

// Новая модель для назначенных карточек
const assignedCardSchema = new mongoose.Schema({
  product: { type: mongoose.Schema.Types.ObjectId, ref: 'Item' },
  order: { type: Number, default: 0 }
});
const AssignedCard = mongoose.model('AssignedCard', assignedCardSchema);

// Функция для получения каталога товаров
async function getItems(query) {
  if (query) {
    return await Item.find({ $text: { $search: query } });
  } else {
    // Если нет поискового запроса – возвращаем первые 4 карточки
    return await Item.find().limit(4);
  }
}

// Главная страница – каталог (передаем items, products и assignedCards)
app.get('/', async (req, res) => {
  const query = req.query.q || '';
  const items = await getItems(query);
  const products = await Item.find({}).sort({ title: 1 });
  const assignedCards = await AssignedCard.find().sort({ order: 1 }).populate('product');
  res.render('search', { items, query, products, assignedCards });
});

// Дополнительный маршрут для "/search"
app.get('/search', async (req, res) => {
  const query = req.query.q || '';
  const items = await getItems(query);
  const products = await Item.find({}).sort({ title: 1 });
  const assignedCards = await AssignedCard.find().sort({ order: 1 }).populate('product');
  res.render('search', { items, query, products, assignedCards });
});

// API для динамического поиска (JSON с найденными продуктами)
app.get('/api/search', async (req, res) => {
  const query = req.query.q;
  let items = [];
  if (query) {
    items = await Item.find({ $text: { $search: query } }).limit(10);
  } else {
    items = await Item.find().limit(4);
  }
  res.json(items);
});

// API для автодополнения – поиск по полю title (без учета регистра)
app.get('/autocomplete', async (req, res) => {
  const query = req.query.q;
  if (!query) return res.json([]);
  try {
    const regex = new RegExp('^' + query, 'i');
    const items = await Item.find({ title: { $regex: regex } }).limit(10);
    res.json(items);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// API-эндпоинт для добавления продукта с валидацией
app.post('/api/add-product', async (req, res) => {
  const { title, description } = req.body;
  if (!title || title.trim() === '') {
    return res.status(400).json({ error: 'Название продукта обязательно' });
  }
  const existing = await Item.findOne({
    title: { $regex: new RegExp('^' + title.trim() + '$', 'i') }
  });
  if (existing) {
    return res.status(400).json({ error: 'Продукт с таким названием уже существует' });
  }
  try {
    const newProduct = new Item({
      title: title.trim(),
      description: description ? description.trim() : ''
    });
    await newProduct.save();
    res.json({ success: true, product: newProduct });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Ошибка сервера при добавлении продукта' });
  }
});

// API: Загрузка изображения для продукта
app.post('/api/upload-image/:id', upload.single('image'), async (req, res) => {
  const { id } = req.params;
  if (!req.file) {
    return res.status(400).json({ error: 'Файл не получен' });
  }
  try {
    const imagePath = '/uploads/' + req.file.filename;
    const updated = await Item.findByIdAndUpdate(
      id,
      { image: imagePath },
      { new: true }
    );
    res.json({ success: true, product: updated });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Ошибка сервера при загрузке изображения' });
  }
});

// Страница управления продуктами
app.get('/manage-products', async (req, res) => {
  const products = await Item.find({}).sort({ title: 1 });
  res.render('manage-products', { products });
});

// API: Обновление продукта
app.put('/api/update-product/:id', async (req, res) => {
  const { id } = req.params;
  const { title, description, image } = req.body;
  const existing = await Item.findOne({
    _id: { $ne: id },
    title: { $regex: new RegExp('^' + title.trim() + '$', 'i') }
  });
  if (existing) {
    return res.status(400).json({ error: 'Продукт с таким названием уже существует' });
  }
  try {
    const updated = await Item.findByIdAndUpdate(
      id,
      { title: title.trim(), description: description.trim(), image: image ? image : undefined },
      { new: true }
    );
    res.json({ success: true, product: updated });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Ошибка сервера при обновлении продукта' });
  }
});

// API: Удаление продукта
app.delete('/api/delete-product/:id', async (req, res) => {
  const { id } = req.params;
  try {
    await Item.findByIdAndDelete(id);
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Ошибка сервера при удалении продукта' });
  }
});

// API: Получение всех назначенных карточек (с данными продукта)
app.get('/api/assigned-cards', async (req, res) => {
  try {
    const cards = await AssignedCard.find().sort({ order: 1 }).populate('product');
    res.json(cards);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Ошибка сервера при получении карточек' });
  }
});

// API: Добавление назначенной карточки
app.post('/api/assign-card', async (req, res) => {
  const { productId } = req.body;
  if (!productId) {
    return res.status(400).json({ error: 'Не передан productId' });
  }
  try {
    // При необходимости можно проверить на дубликаты
    const newCard = new AssignedCard({ product: productId });
    await newCard.save();
    await newCard.populate('product');
    res.json({ success: true, card: newCard });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Ошибка сервера при добавлении карточки' });
  }
});

// API: Удаление  карточки
app.delete('/api/assign-card/:cardId', async (req, res) => {
    const { cardId } = req.params;
  
    if (!mongoose.Types.ObjectId.isValid(cardId)) {
      return res.status(400).json({ error: 'Неверный ObjectId карточки' });
    }
  
    try {
      const deletedCard = await AssignedCard.findByIdAndDelete(cardId);
      if (!deletedCard) {
        return res.status(404).json({ error: 'Карточка не найдена' });
      }
      res.json({ success: true });
    } catch (err) {
      console.error('Error removing assigned card:', err);
      res.status(500).json({ error: 'Ошибка сервера при удалении карточки' });
    }
  });

// Запускаем сервер
const PORT = 3000;
app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});
