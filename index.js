const express = require('express');
const mysql = require('mysql2');
const ejs = require('ejs');
const bodyParser = require('body-parser');
const session = require('express-session');

const app = express();
const port = 8080;

app.set('view engine', 'ejs');
app.use(bodyParser.urlencoded({ extended: true }));
app.use(session({
    secret: 'secret-key',
    resave: false,
    saveUninitialized: true
}));

const db = mysql.createConnection({
    host: 'localhost',
    user: 'root',
    password: '',
    database: 'EatEase'
});

// Добавление абонемента
app.post('/add', (req, res) => {
    const { name, description, price } = req.body;
    db.query('INSERT INTO dishes ( name, description, price) VALUES (?, ?, ?)', [ name, description, price], (err) => {
        if (err) {
            console.error('Error adding sub:', err);
            return res.status(500).send('Error adding sub');
        }
        res.redirect('/'); // После успешного добавления абонемента перенаправляем пользователя на главную страницу
    });
});

// Проверка аутентификации пользователя
const isAuthenticated = (req, res, next) => {
    if (req.session.authenticated) {
        next();
    } else {
        res.redirect('/login');
    }
};

// Главная страница - Абонемент
app.get('/',  (req, res) => {
    db.query('SELECT * FROM dishes', (err, results) => {
        if (err) {
            console.error('Error fetching dishes:', err);
            return res.status(500).send('Error fetching dishes');
        }
        const dishes = results; // Полученные продукты из базы данных

        // Получаем идентификатор пользователя из сессии
        const userId = req.session.userId;

        // Запрос к базе данных для получения информации о пользователе, включая его приоритет
        db.query('SELECT priority FROM users WHERE id = ?', [userId], (err, userResults) => {
            if (err) {
                console.error('Error fetching user priority:', err);
                return res.status(500).send('Error fetching user priority');
            }

            // Получаем приоритет пользователя из результатов запроса
            const userPriority = req.session.userPriority || 0;

            // Определяем букву в углу экрана в зависимости от приоритета пользователя
            let cornerLetter = '';
            if (userPriority === 2) {
                cornerLetter = 'A';
            }

            // Передаем продукты, букву и приоритет пользователя в шаблон
            res.render('index', { dishes, cornerLetter, userPriority });
        });
    });
});

// Обработка GET запроса на страницу корзины
app.get('/cart', isAuthenticated, (req, res) => {
    // Получаем компоненты из сессии или базы данных корзины
    const cart = req.session.cart || [];

    // Получаем приоритет пользователя из сессии
    const userPriority = req.session.userPriority || 0;

    // Проверяем, что cart не пустой и содержит объекты с id_dishes
    if (cart.length > 0 && cart.every(item => item && item.sub_id)) {
        const placeholders = cart.map(() => '?').join(',');
        db.query(`SELECT id_dishes, name, description, price FROM dishes WHERE id_dishes IN (${placeholders})`, cart.map(item => item.sub_id), (err, results) => {
            if (err) {
                console.error('Error fetching cart items:', err);
                return res.status(500).send('Error fetching cart items');
            }

            // Создаем массив для хранения информации о товарах в корзине
            const cartItems = [];

            // Создаем объект для каждого товара в корзине с дополнительной информацией о количестве
            results.forEach((sub, index) => {
                const quantity = cart[index].quantity;
                cartItems.push({
                    id_dishes: sub.id_dishes,
                    name: sub.name,
                    description: sub.description,
                    price: sub.price,
                    quantity
                });
            });

            // Вычисляем общую стоимость товаров в корзине
            const totalCartPrice = cartItems.reduce((total, item) => total + item.price * item.quantity, 0);

            // Отображаем страницу корзины с информацией о товарах, общей стоимостью и приоритетом пользователя
            res.render('cart', { cart: cartItems, totalCartPrice, isAuthenticated: req.session.authenticated, userPriority });
        });
    } else {
        // Если корзина пуста или содержит неправильные данные, просто отображаем страницу корзины без товаров
        res.render('cart', { cart: [], totalCartPrice: 0, isAuthenticated: req.session.authenticated, userPriority });
    }
});

// Обработка добавления в корзину
app.post('/cart', (req, res) => {
    const { sub_id, quantity } = req.body;
    
    // Добавляем выбранный продукт в сессию корзины
    req.session.cart = req.session.cart || []; // Создаем корзину, если она еще не существует
    req.session.cart.push({ sub_id, quantity }); // Добавляем товар в корзину

    res.redirect('/'); // Перенаправляем пользователя на главную страницу после добавления товара в корзину
});

// Удаление товара из корзины
app.post('/cart/remove', (req, res) => {
    const subIdToRemove = req.body.sub_id;
    const cart = req.session.cart || [];

    // Фильтруем товары в корзине, оставляя только те, которые необходимо удалить
    req.session.cart = cart.filter(item => item.sub_id !== subIdToRemove);

    res.redirect('/cart'); // Перенаправляем пользователя на страницу корзины после удаления товара
});

// Страница Оформления заказа
app.get('/order', isAuthenticated, (req, res) => {
    const userPriority = req.session.userPriority || 0;
    res.render('order', { isAuthenticated: req.session.authenticated, userPriority });
});

// Обработка оформления заказа
app.post('/order', isAuthenticated, (req, res) => {
    const { name, address } = req.body;
    const userId = req.session.userId; // Предполагается, что userId сохранен в сессии после успешной аутентификации
    const orderDate = new Date(); // Получаем текущую дату и время
    const cart = req.session.cart || [];

    // Создание нового заказа в таблице orders
    db.query('INSERT INTO orders (user_id, order_date, name, address) VALUES (?, ?, ?, ?)',
        [userId, orderDate, name, address], (err, result) => {
            if (err) {
                console.error('Error creating order:', err);
                return res.status(500).send('Error creating order');
            }

            const orderId = result.insertId; // Получаем идентификатор только что созданного заказа

// Добавление каждого товара из корзины в таблицу order_items
            const promises = cart.map(item => {
                return new Promise((resolve, reject) => {
                    db.query('INSERT INTO order_items ( order_id, subscription, quantity) VALUES (?, ?, ?)',
                        [orderId, item.sub_id, item.quantity], (err) => {
                            if (err) {
                                reject(err);
                            } else {
                                resolve();
                            }
                        });
                });
            });

            // Ждем завершения всех запросов к базе данных
            Promise.all(promises)
                .then(() => {
                    // После успешного добавления всех товаров в корзине в таблицу order_items, очищаем корзину
                    req.session.cart = [];
                    res.redirect('/cart'); // Перенаправляем на страницу корзины после успешного оформления заказа
                })
                .catch(error => {
                    console.error('Error adding order items:', error);
                    res.status(500).send('Error adding order items');
                });
        });
});

// Страница Авторизация
app.get('/login', (req, res) => {
    res.render('login', { isAuthenticated: req.session.authenticated });
});

// Роуты для админ-панели
app.get('/admin', isAuthenticated, (req, res) => {
    // Проверяем, аутентифицирован ли пользователь и имеет ли он приоритет 2
    if (req.session.authenticated && req.session.userPriority === 2) {
        // Если аутентификация пройдена и пользователь имеет приоритет 2, отображаем страницу админ-панели
        const cornerLetter = 'A'; // Пример значения для cornerLetter
        res.render('admin', { cornerLetter }); // Передаем cornerLetter в шаблон
    } else {
        // Если пользователь не аутентифицирован или у него нет приоритета 2, перенаправляем на главную страницу
        res.redirect('/');
    }
});

// Роут для отображения страницы управления абонементами
app.get('/admin/dishes', isAuthenticated, (req, res) => {
    // Проверяем, аутентифицирован ли пользователь и имеет ли он приоритет 2
    if (req.session.authenticated && req.session.userPriority === 2) {
        // Если аутентификация пройдена и пользователь имеет приоритет 2, отображаем страницу управления абонементами
        db.query('SELECT * FROM dishes', (err, results) => {
            if (err) {
                console.error('Error fetching dishes:', err);
                return res.status(500).send('Error fetching dishes');
            }
            const dishes = results;
            // Добавляем переменную cornerLetter, которая будет передаваться в шаблон
            const cornerLetter = 'A'; // Пример значения для cornerLetter
            res.render('admindishes', { dishes, cornerLetter });
        });
    } else {
        // Если пользователь не аутентифицирован или у него нет приоритета 2, перенаправляем на главную страницу
        res.redirect('/');
    }
});

// Роут для обновления информации о абонементе
app.post('/admin/dishes/update/:subId', isAuthenticated, (req, res) => {
    const { name, description, price } = req.body;
    const subId = req.params.subId;
    
    // Проверяем, аутентифицирован ли пользователь и имеет ли он приоритет 2
    if (req.session.authenticated && req.session.userPriority === 2) {
        // Если аутентификация пройдена и пользователь имеет приоритет 2, обновляем информацию о абонементе
        db.query('UPDATE dishes SET name = ?, description = ?, price = ? WHERE id_dishes = ?', [name, description, price, subId], (err) => {
            if (err) {
                console.error('Error updating sub:', err);
                return res.status(500).send('Error updating sub');
            }
            res.redirect('/admin/dishes');
        });
    } else {
        // Если пользователь не аутентифицирован или у него нет приоритета 2, перенаправляем на главную страницу
        res.redirect('/');
    }
});

// Роут для удаления абонемента
app.post('/admin/dishes/delete/:subId', isAuthenticated, (req, res) => {
    const subId = req.params.subId;
    
    // Проверяем, аутентифицирован ли пользователь и имеет ли он приоритет 2
    if (req.session.authenticated && req.session.userPriority === 2) {
        // Если аутентификация пройдена и пользователь имеет приоритет 2, удаляем абонемент
        db.query('DELETE FROM dishes WHERE id_dishes = ?', [subId], (err) => {
            if (err) {
                console.error('Error deleting sub:', err);
                return res.status(500).send('Error deleting sub');
            }
            res.redirect('/admin/dishes');
        });
    } else {
        // Если пользователь не аутентифицирован или у него нет приоритета 2, перенаправляем на главную страницу
        res.redirect('/');
    }
});

// Роут для отображения зарегистрированных пользователей в админ панели
app.get('/admin/users', isAuthenticated, (req, res) => {
    // Проверяем, аутентифицирован ли пользователь и имеет ли он приоритет
    if (req.session.authenticated && req.session.userPriority === 2) {
        // Если аутентификация пройдена и пользователь имеет приоритет 2,
        // получаем информацию о зарегистрированных пользователях из базы данных
        db.query('SELECT * FROM users', (err, users) => {
            if (err) {
                console.error('Error fetching users:', err);
                return res.status(500).send('Error fetching users');
            }
            // Отображаем страницу админ панели с информацией о зарегистрированных пользователях
            res.render('adminUsers', { users });
        });
    } else {
        // Если пользователь не аутентифицирован или у него нет приоритета 2, перенаправляем на главную страницу
        res.redirect('/');
    }
});

// Роут для смены приоритета пользователя
app.post('/admin/users/switchPriority/:userId', isAuthenticated, (req, res) => {
    const userId = req.params.userId;
    
    // Проверяем, аутентифицирован ли пользователь и имеет ли он приоритет 2
    if (req.session.authenticated && req.session.userPriority === 2) {
        // Получаем текущий приоритет пользователя из базы данных
        db.query('SELECT priority FROM users WHERE id = ?', [userId], (err, results) => {
            if (err) {
                console.error('Error fetching user priority:', err);
                return res.status(500).send('Error fetching user priority');
            }

            if (results.length === 0) {
                return res.status(404).send('User not found');
            }

            const currentPriority = results[0].priority;
            const newPriority = currentPriority === 1 ? 2 : 1; // Если текущий приоритет 1, меняем на 2, и наоборот

            // Обновляем приоритет пользователя в базе данных
            db.query('UPDATE users SET priority = ? WHERE id = ?', [newPriority, userId], (err) => {
                if (err) {
                    console.error('Error updating user priority:', err);
                    return res.status(500).send('Error updating user priority');
                }

                res.redirect('/admin/users'); // Перенаправляем на страницу управления пользователями
            });
        });
    } else {
        // Если пользователь не аутентифицирован или у него нет приоритета 2, перенаправляем на главную страницу
        res.redirect('/');
    }
});


// Роут для отображения страницы управления заказами
app.get('/admin/orders', isAuthenticated, (req, res) => {
    // Проверяем, аутентифицирован ли пользователь и имеет ли он приоритет
    if (req.session.authenticated && req.session.userPriority) {
        // Если аутентификация пройдена, получаем информацию о заказах из базы данных
        db.query('SELECT * FROM orders', (err, orders) => {
            if (err) {
                console.error('Error fetching orders:', err);
                return res.status(500).send('Error fetching orders');
            }
            // Получаем информацию о товарах в каждом заказе, включая количество
            const promises = orders.map(order => {
                return new Promise((resolve, reject) => {
                    // Запрос к базе данных для получения информации о абонементах в заказе, включая количество
                    db.query('SELECT dishes.name, dishes.description, dishes.price, order_items.quantity FROM dishes INNER JOIN order_items ON dishes.id_dishes = order_items.subscription WHERE order_items.order_id = ?', [order.order_id], (err, items) => {
                        if (err) {
                            reject(err);
                        } else {
                            order.items = items;
                            resolve(order);
                        }
                    });
                });
            });
            // Ждем завершения всех запросов к базе данных и отображаем страницу с полными данными о заказах
            Promise.all(promises)
                .then(ordersWithItems => {
                    res.render('adminOrders', { orders: ordersWithItems });
                })
                .catch(error => {
                    console.error('Error fetching order items:', error);
                    res.status(500).send('Error fetching order items');
                });
        });
    } else {
        // Если пользователь не аутентифицирован, перенаправляем на страницу входа
        res.redirect('/login');
    }
});

app.post('/login', (req, res) => {
    const { username, password, priority } = req.body;
    db.query('SELECT * FROM users WHERE username = ?', [username], (err, results) => {
        if (err) {
            console.error('Error fetching user:', err);
            return res.status(500).send('Error fetching user');
        }

        if (results.length === 0) {
            // Если пользователь не существует, добавляем его в базу данных
            db.query('INSERT INTO users (username, password, priority) VALUES (?, ?, ?)', [username, password, priority], (err) => {
                if (err) {
                    console.error('Error adding user:', err);
                    return res.status(500).send('Error adding user');
                }
                // Устанавливаем аутентификацию в сессии и идентификатор пользователя
                req.session.authenticated = true;
                req.session.userId = results.insertId; // Сохраняем идентификатор пользователя в сессии
                req.session.userPriority = priority; // Устанавливаем приоритет пользователя в сессии
                res.redirect('/');
            });
        } else {
            const user = results[0];
            if (user.password === password) {
                // Если пароль верный, устанавливаем флаг аутентификации и идентификатор пользователя в сессии
                req.session.authenticated = true;
                req.session.userId = user.id; // Сохраняем идентификатор пользователя в сессии
                req.session.userPriority = user.priority; // Устанавливаем приоритет пользователя в сессии
                res.redirect('/');
            } else {
                // Если пароль неверный, отображаем сообщение о неправильном пароле
                res.render('login', { error: 'Неправильный пароль', isAuthenticated: req.session.authenticated });
            }
        }
    });
});

// Роут для страницы справки
app.get('/help', (req, res) => {
    // Отображаем страницу справки
    res.render('help');
});

// Выход из аккаунта
app.get('/logout', (req, res) => {
    // Удаляем флаг аутентификации из сессии
    req.session.authenticated = false;
    res.redirect('/login');
});

app.listen(port, () => {
    console.log(`Server running at http://localhost:${port}`);
});