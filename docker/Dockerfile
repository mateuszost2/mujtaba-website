FROM nginx:alpine

COPY ../index.html /usr/share/nginx/html/index.html
#Mount media under /usr/share/nginx/html/media:ro

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
