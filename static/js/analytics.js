/**
 * Vercel Web Analytics initialization
 * This file initializes Vercel Web Analytics for tracking page views and user interactions
 * 
 * Using the inline script approach since this is a Flask app without a module bundler
 */

(function() {
  // Initialize the analytics queue
  window.va = window.va || function () { 
    (window.vaq = window.vaq || []).push(arguments); 
  };

  // Load the Vercel Analytics script
  var script = document.createElement('script');
  script.defer = true;
  script.src = '/_vercel/insights/script.js';
  
  // Insert the script into the document
  var firstScript = document.getElementsByTagName('script')[0];
  firstScript.parentNode.insertBefore(script, firstScript);
})();
