const gulp = require('gulp');
const yarn = require('gulp-yarn');
const zip = require('gulp-zip');
const del = require('del');

gulp.task('clean', () => (
    del('build')
));

gulp.task('yarn', ['clean'], () => {
    const yarnFiles = [
        'package.json',
        'yarn.lock',
        '.yarnclean',
    ];
    const srcFiles = [
        'index.js',
        '*lib/**/*',
    ];
    return gulp.src(yarnFiles.concat(srcFiles))
        .pipe(gulp.dest('build'))
        .pipe(yarn({ production: true }));
});

gulp.task('build', ['yarn'], () => (
    gulp.src('build/**/*')
        .pipe(zip('build.zip'))
        .pipe(gulp.dest('dist'))
));
