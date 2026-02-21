// Mobile Navigation Toggle
const hamburger = document.querySelector('.hamburger');
const navMenu = document.querySelector('.nav-menu');

if (hamburger) {
    hamburger.addEventListener('click', () => {
        navMenu.classList.toggle('active');
    });
}

// Close mobile menu when clicking on a link
document.querySelectorAll('.nav-menu a').forEach(link => {
    link.addEventListener('click', () => {
        navMenu.classList.remove('active');
    });
});

// Smooth scrolling for navigation links
document.querySelectorAll('a[href^="#"]').forEach(anchor => {
    anchor.addEventListener('click', function (e) {
        e.preventDefault();
        const target = document.querySelector(this.getAttribute('href'));
        if (target) {
            const offsetTop = target.offsetTop - 70;
            // Animate scroll with custom easing
            const start = window.pageYOffset;
            const distance = offsetTop - start;
            const duration = Math.min(1200, Math.max(500, Math.abs(distance) * 0.6));
            let startTime = null;

            function easeInOutCubic(t) {
                return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
            }

            function animateScroll(currentTime) {
                if (!startTime) startTime = currentTime;
                const elapsed = currentTime - startTime;
                const progress = Math.min(elapsed / duration, 1);
                const eased = easeInOutCubic(progress);
                window.scrollTo(0, start + distance * eased);
                if (progress < 1) requestAnimationFrame(animateScroll);
            }
            requestAnimationFrame(animateScroll);
        }
    });
});

// Navbar background change is handled by the unified scroll handler below

// Contact Form Handler with EmailJS
const contactForm = document.getElementById('contactForm');
const formStatus = document.getElementById('form-status');

// Initialize EmailJS from shared config (firebase-config.js)
// Falls back to direct init if config not available
if (typeof EMAILJS_CONFIG !== 'undefined' && !EMAILJS_CONFIG.publicKey.startsWith('__EMAILJS')) {
    emailjs.init(EMAILJS_CONFIG.publicKey);
} else {
    emailjs.init('__EMAILJS_PUBLIC_KEY__');
}

if (contactForm) {
    contactForm.addEventListener('submit', (e) => {
        e.preventDefault();
        
        // Disable submit button to prevent multiple submissions
        const submitButton = contactForm.querySelector('.submit-button');
        const originalButtonText = submitButton.textContent;
        submitButton.disabled = true;
        submitButton.textContent = 'Sending...';
        
        // Get form data
        const formData = {
            name: contactForm.name.value,
            email: contactForm.email.value,
            phone: contactForm.phone.value || 'Not provided',
            message: contactForm.message.value
        };
        
        // Build admin notification email
        console.log('Attempting to send email with data:', formData);
        const adminBody = '<p style="font-size:15px;color:#333;">Hi Sanz,</p>' +
          '<p style="color:#555;">You\'ve received a new inquiry from your website:</p>' +
          '<table style="width:100%;font-size:14px;margin:16px 0;">' +
            '<tr><td style="padding:6px 12px;font-weight:600;color:#c44569;width:80px;">Name</td><td style="padding:6px 12px;">' + formData.name + '</td></tr>' +
            '<tr style="background:#fff5f7;"><td style="padding:6px 12px;font-weight:600;color:#c44569;">Email</td><td style="padding:6px 12px;"><a href="mailto:' + formData.email + '">' + formData.email + '</a></td></tr>' +
            '<tr><td style="padding:6px 12px;font-weight:600;color:#c44569;">Phone</td><td style="padding:6px 12px;">' + formData.phone + '</td></tr>' +
          '</table>' +
          '<div style="background:#f9f9f9;padding:16px;border-radius:8px;border-left:3px solid #ff6b9d;">' +
            '<strong style="color:#c44569;">Message:</strong>' +
            '<p style="margin:8px 0 0;color:#444;">' + formData.message.replace(/\n/g, '<br>') + '</p>' +
          '</div>';

        sendBrandedEmail('sanz.the.nanny@gmail.com', 'New Inquiry from ' + formData.name, 'New Contact Inquiry', adminBody, null, formData.email)
            .then((response) => {
                // Success
                console.log('Email sent successfully!', response);
                formStatus.textContent = '✓ Message sent successfully! I\'ll get back to you soon.';
                formStatus.className = 'form-status success';

                // Save as prospective client in Firebase
                if (typeof firebaseReady !== 'undefined' && firebaseReady && typeof fbPush === 'function') {
                    fbPush('/prospects', {
                        name: formData.name,
                        email: formData.email,
                        phone: formData.phone,
                        message: formData.message,
                        source: 'contact_form',
                        status: 'new',
                        created_at: new Date().toISOString()
                    }).then(() => console.log('Prospect saved'))
                      .catch(err => console.warn('Prospect save failed:', err));
                }

                // Send auto-reply to the visitor
                const replyBody = '<p style="font-size:15px;color:#333;">Hi ' + formData.name + ',</p>' +
                  '<p style="color:#555;">Thank you for reaching out! I\'ve received your message and will get back to you within 24 hours.</p>' +
                  '<div style="background:#fff5f7;padding:16px;border-radius:8px;margin:16px 0;">' +
                    '<strong style="color:#c44569;">Your Message:</strong>' +
                    '<p style="margin:8px 0 0;color:#444;">' + formData.message.replace(/\n/g, '<br>') + '</p>' +
                  '</div>' +
                  '<p style="color:#555;">Looking forward to connecting with you!</p>' +
                  '<p style="color:#c44569;font-weight:600;">&mdash; Sanz</p>';
                sendBrandedEmail(formData.email, 'Thanks for reaching out! - Sanz the Nanny', 'Message Received!', replyBody, 'This is an automated response.').catch(err => console.warn('Auto-reply failed:', err));

                contactForm.reset();
                
                // Hide success message after 5 seconds
                setTimeout(() => {
                    formStatus.textContent = '';
                    formStatus.className = 'form-status';
                }, 5000);
            })
            .catch((error) => {
                // Error
                console.error('EmailJS Error Details:', error);
                console.error('Error status:', error.status);
                console.error('Error text:', error.text);
                
                let errorMessage = '✗ Failed to send message. ';
                if (error.status === 403 || error.status === 401) {
                    errorMessage += 'Authentication failed. Check your EmailJS credentials.';
                } else if (error.text) {
                    errorMessage += error.text;
                } else {
                    errorMessage += 'Please try again or email directly.';
                }
                
                formStatus.textContent = errorMessage;
                formStatus.className = 'form-status error';
            })
            .finally(() => {
                // Re-enable submit button
                submitButton.disabled = false;
                submitButton.textContent = originalButtonText;
            });
    });
}

// ── Scroll-reveal animation system ──
(function initRevealAnimations() {
    // Section titles
    document.querySelectorAll('.section-title').forEach(el => el.classList.add('reveal'));

    // Grid containers get stagger treatment
    document.querySelectorAll('.services-grid, .gallery-grid, .testimonials-grid, .about-highlights').forEach(el => {
        el.classList.add('reveal', 'reveal-stagger');
    });

    // Individual cards / items that aren't inside a stagger parent
    document.querySelectorAll(
        '.qualification-item, .contact-content, .trial-content, .references-note'
    ).forEach(el => el.classList.add('reveal'));

    // Alternate left/right for qualification items
    document.querySelectorAll('.qualification-item').forEach((el, i) => {
        el.classList.add(i % 2 === 0 ? 'reveal-left' : 'reveal-right');
    });

    // About image from left, text from right
    const aboutImg = document.querySelector('.about-image');
    const aboutTxt = document.querySelector('.about-text');
    if (aboutImg) aboutImg.classList.add('reveal', 'reveal-left');
    if (aboutTxt) aboutTxt.classList.add('reveal', 'reveal-right');

    // Contact halves
    const contactInfo = document.querySelector('.contact-info');
    const contactForm = document.querySelector('.contact-form');
    if (contactInfo) contactInfo.classList.add('reveal', 'reveal-left');
    if (contactForm) contactForm.classList.add('reveal', 'reveal-right');

    // Intersection observer that adds .revealed
    const revealObserver = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                entry.target.classList.add('revealed');
                revealObserver.unobserve(entry.target); // animate only once
            }
        });
    }, { threshold: 0.12, rootMargin: '0px 0px -40px 0px' });

    document.querySelectorAll('.reveal').forEach(el => revealObserver.observe(el));
})();

// ── Active nav indicator on scroll ──
const _navLinks = document.querySelectorAll('.nav-menu a');
const _sections = document.querySelectorAll('section[id]');

function updateActiveNav() {
    const scrollY = window.pageYOffset;
    let current = '';
    _sections.forEach(section => {
        if (scrollY >= section.offsetTop - 120) current = section.getAttribute('id');
    });
    _navLinks.forEach(link => {
        link.classList.toggle('active', link.getAttribute('href') === `#${current}`);
    });
}

// ── Scroll progress bar ──
const _progressBar = document.getElementById('scrollProgress');
function updateScrollProgress() {
    const scrollTop = window.pageYOffset;
    const docHeight = document.documentElement.scrollHeight - window.innerHeight;
    const pct = docHeight > 0 ? (scrollTop / docHeight) * 100 : 0;
    if (_progressBar) _progressBar.style.width = pct + '%';
}

// Unified scroll handler (throttled via rAF)
let _scrollRAF = null;
window.addEventListener('scroll', () => {
    if (_scrollRAF) return;
    _scrollRAF = requestAnimationFrame(() => {
        updateActiveNav();
        updateScrollProgress();

        // Navbar background
        const navbar = document.querySelector('.navbar');
        if (window.scrollY > 50) {
            navbar.style.background = 'rgba(255, 255, 255, 0.98)';
            navbar.style.backdropFilter = 'blur(10px)';
        } else {
            navbar.style.background = '#ffffff';
        }

        _scrollRAF = null;
    });
}, { passive: true });

// Run once on load
updateActiveNav();
updateScrollProgress();

// Gallery Lightbox Functionality
const lightbox = document.getElementById('lightbox');
const lightboxImg = document.getElementById('lightbox-img');
const lightboxClose = document.querySelector('.lightbox-close');
const lightboxPrev = document.querySelector('.lightbox-prev');
const lightboxNext = document.querySelector('.lightbox-next');
const galleryItems = document.querySelectorAll('.gallery-item');
let currentImageIndex = 0;

// Create array of image sources
const imageSources = Array.from(galleryItems).map(item => {
    const img = item.querySelector('img');
    return { src: img.src, alt: img.alt };
});

// Function to show image at specific index
function showImage(index) {
    if (index < 0) index = imageSources.length - 1;
    if (index >= imageSources.length) index = 0;
    currentImageIndex = index;
    lightboxImg.src = imageSources[index].src;
    lightboxImg.alt = imageSources[index].alt;
}

// Open lightbox when clicking on gallery item
galleryItems.forEach((item, index) => {
    item.addEventListener('click', () => {
        currentImageIndex = index;
        showImage(currentImageIndex);
        lightbox.classList.add('active');
        document.body.style.overflow = 'hidden'; // Prevent scrolling
    });
});

// Navigate to previous image
lightboxPrev.addEventListener('click', (e) => {
    e.stopPropagation();
    showImage(currentImageIndex - 1);
});

// Navigate to next image
lightboxNext.addEventListener('click', (e) => {
    e.stopPropagation();
    showImage(currentImageIndex + 1);
});

// Close lightbox when clicking the close button
lightboxClose.addEventListener('click', () => {
    lightbox.classList.remove('active');
    document.body.style.overflow = 'auto'; // Restore scrolling
});

// Close lightbox when clicking outside the image
lightbox.addEventListener('click', (e) => {
    if (e.target === lightbox) {
        lightbox.classList.remove('active');
        document.body.style.overflow = 'auto'; // Restore scrolling
    }
});

// Keyboard navigation
document.addEventListener('keydown', (e) => {
    if (lightbox.classList.contains('active')) {
        if (e.key === 'Escape') {
            lightbox.classList.remove('active');
            document.body.style.overflow = 'auto'; // Restore scrolling
        } else if (e.key === 'ArrowLeft') {
            showImage(currentImageIndex - 1);
        } else if (e.key === 'ArrowRight') {
            showImage(currentImageIndex + 1);
        }
    }
});
