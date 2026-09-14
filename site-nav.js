(function () {
    function initSharedNav() {
        var header = document.querySelector('header.site-header');
        if (!header) return;

        var oldButton = header.querySelector('.hamburger');
        var nav = header.querySelector('nav');
        if (!oldButton || !nav) return;

        var button = oldButton.cloneNode(true);
        oldButton.parentNode.replaceChild(button, oldButton);

        function setOpen(isOpen) {
            button.classList.toggle('active', isOpen);
            nav.classList.toggle('active', isOpen);
            document.body.classList.toggle('site-nav-open', isOpen);
            button.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
        }

        window.toggleMenu = function () {
            setOpen(!button.classList.contains('active'));
        };

        button.addEventListener('click', function () {
            window.toggleMenu();
        });

        nav.querySelectorAll('a').forEach(function (link) {
            link.addEventListener('click', function () {
                setOpen(false);
            });
        });

        document.addEventListener('keydown', function (event) {
            if (event.key === 'Escape') setOpen(false);
        });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initSharedNav);
    } else {
        initSharedNav();
    }
})();
